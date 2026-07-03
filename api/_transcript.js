// api/_transcript.js — Internal transcript helper (not an endpoint).
// Vercel ignores _-prefixed files in api/ as endpoints.
//
// Fetches a plain-text transcript for a video URL via Supadata.
// Used by the mining pipeline to enrich hook extraction.

const SUPADATA_KEY = process.env.SUPADATA_API_KEY || '';

/**
 * Fetch transcript text for a video URL. Throws on failure.
 * @param {string} videoUrl
 * @returns {Promise<{ text: string }>}
 */
export async function fetchTranscript(videoUrl) {
  if (!SUPADATA_KEY) throw new Error('Transcript service is not configured.');

  const res = await fetch(
    `https://api.supadata.ai/v1/transcript?url=${encodeURIComponent(videoUrl)}`,
    { headers: { 'x-api-key': SUPADATA_KEY } }
  );

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
  return { text };
}
