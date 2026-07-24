// api/_transcript.js — Internal transcript helper (not an endpoint).
// Vercel ignores _-prefixed files in api/ as endpoints.
//
// Fetches a plain-text transcript for a video URL via Supadata.
// Used by the mining pipeline to enrich hook extraction.

import { logUsage } from './_db.js';

const SUPADATA_KEY = process.env.SUPADATA_API_KEY || '';
const TRANSCRIPT_REQUEST_TIMEOUT_MS = 12_000;
const TRANSCRIPT_MAX_ATTEMPTS = 3;
const TRANSCRIPT_RETRY_BASE_MS = 500;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Backoff before retrying a rate-limited transcript fetch. Honours a numeric
 * Retry-After header when present, otherwise grows exponentially.
 * @param {number} attempt 1-based attempt number that was just rate limited
 * @param {string|null} [retryAfterHeader]
 * @returns {number} milliseconds to wait before the next attempt
 */
export function transcriptRetryDelayMs(attempt, retryAfterHeader) {
  const headerSeconds = Number.parseInt(retryAfterHeader ?? '', 10);
  if (Number.isFinite(headerSeconds) && headerSeconds > 0) return headerSeconds * 1000;
  return TRANSCRIPT_RETRY_BASE_MS * 2 ** (attempt - 1);
}

/**
 * Fetch transcript text for a video URL. Throws on failure.
 * Retries HTTP 429 with backoff so a burst of requests against Supadata's rate
 * limit is paced out instead of discarding otherwise-usable candidates.
 * @param {string} videoUrl
 * @param {{ fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>, maxAttempts?: number }} [deps]
 * @returns {Promise<{ text: string }>}
 */
export async function fetchTranscript(videoUrl, {
  fetchImpl = fetch,
  sleep = defaultSleep,
  maxAttempts = TRANSCRIPT_MAX_ATTEMPTS,
} = {}) {
  if (!SUPADATA_KEY) throw new Error('Transcript service is not configured.');

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetchImpl(
      `https://api.supadata.ai/v1/transcript?url=${encodeURIComponent(videoUrl)}`,
      {
        headers: { 'x-api-key': SUPADATA_KEY },
        signal: AbortSignal.timeout(TRANSCRIPT_REQUEST_TIMEOUT_MS),
      }
    );

    // Rate limited: pace out and retry rather than throwing away the candidate.
    if (res.status === 429) {
      lastError = new Error('Transcript service error (429)');
      if (attempt < maxAttempts) {
        const retryAfter = res.headers?.get?.('retry-after');
        await sleep(transcriptRetryDelayMs(attempt, retryAfter));
        continue;
      }
      throw lastError;
    }

    if (res.status === 202) throw new Error('Transcript still processing.');
    if (!res.ok) throw new Error(`Transcript service error (${res.status})`);

    const data = await res.json();
    const content = data?.content || data;
    const rawSegments = Array.isArray(content) ? content : content?.segments || content?.transcript || [];

    const text = rawSegments
      .filter((s) => s.text?.trim())
      .map((s) => s.text.trim())
      .join(' ');

    if (!text) throw new Error('No captions available.');
    // Best-effort credit log (Supadata bills per transcript); not awaited.
    logUsage({ provider: 'supadata', op: 'transcript' });
    return { text };
  }

  throw lastError;
}
