// api/transcript.js
// Deploy on Vercel (free tier) as a serverless function.
//
// Uses Supadata API to fetch YouTube captions (handles bot detection).
// Set SUPADATA_API_KEY in Vercel environment variables.

import { getSession } from './_db.js';

const SUPADATA_KEY = process.env.SUPADATA_API_KEY || '';

// =============================================================
// IN-MEMORY RATE LIMITER (per serverless instance)
// =============================================================
const rateMap = new Map();
const RATE_LIMIT = 10;
const RATE_WINDOW = 60000;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateMap) {
    if (now > entry.resetAt) rateMap.delete(ip);
  }
}, RATE_WINDOW);

export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  const allowed = !origin || (function() { try { return new URL(origin).host === host; } catch { return false; } })();
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const videoId = req.query.v;
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Invalid or missing video ID' });
  }

  const mode = req.query.mode || 'single';

  // ===== RATE LIMITING (single mode only) =====
  if (mode === 'single') {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.headers['x-real-ip']
      || req.socket?.remoteAddress
      || 'unknown';
    if (isRateLimited(ip)) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please wait a moment before trying again.' });
    }
  }

  // ===== SESSION VERIFICATION (bulk mode) =====
  if (mode === 'bulk') {
    try {
      const user = await getSession(req);
      if (!user || user.tier !== 'pro') {
        return res.status(402).json({ error: 'Pro subscription required for bulk downloads.', upgrade: true });
      }
    } catch (e) {
      console.error('Session check failed:', e.message);
      return res.status(402).json({ error: 'Pro subscription required for bulk downloads.', upgrade: true });
    }
  }

  // ===== FETCH TRANSCRIPT VIA SUPADATA =====
  if (!SUPADATA_KEY) {
    return res.status(500).json({ error: 'Transcript service is not available.' });
  }

  try {
    const result = await fetchTranscript(videoId);

    if (result.success) {
      return res.status(200).json({
        ...result.data,
        source: 'supadata',
      });
    }

    return res.status(404).json({
      error: result.error,
      source: 'none',
    });
  } catch (error) {
    console.error('Transcript handler error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}


// =============================================================
// FETCH TRANSCRIPT VIA SUPADATA API
// =============================================================
async function fetchTranscript(videoId) {
  try {
    const res = await fetch(
      `https://api.supadata.ai/v1/transcript?url=https://www.youtube.com/watch?v=${videoId}`,
      { headers: { 'x-api-key': SUPADATA_KEY } }
    );

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.log(`Supadata HTTP ${res.status}: ${errBody.substring(0, 200)}`);
      return { success: false, error: `Transcript service error (${res.status})` };
    }

    const data = await res.json();
    const content = data?.content || data;

    // Supadata returns { content: [{ text, offset, duration, lang }] }
    const rawSegments = Array.isArray(content) ? content : content?.segments || content?.transcript || [];

    if (!rawSegments.length) {
      return { success: false, error: 'No captions available for this video.' };
    }

    const segments = rawSegments
      .filter(s => s.text?.trim())
      .map(s => ({
        start: (s.offset != null ? s.offset / 1000 : parseFloat(s.start)) || 0,
        duration: (s.duration != null ? s.duration / 1000 : parseFloat(s.dur)) || 0,
        text: s.text.trim(),
      }));

    if (segments.length === 0) {
      return { success: false, error: 'No captions available for this video.' };
    }

    const title = await getVideoTitle(videoId) || `Video ${videoId}`;
    const lang = rawSegments[0]?.lang || 'en';
    console.log(`Supadata: success, ${segments.length} segments, lang=${lang}`);

    return {
      success: true,
      data: {
        title, videoId,
        language: lang,
        isAutoGenerated: false,
        durationSeconds: null,
        segments,
        totalSegments: segments.length,
      }
    };
  } catch (err) {
    return { success: false, error: `Transcript service error: ${err.message}` };
  }
}


// =============================================================
// HELPER: Get video title via oEmbed
// =============================================================
async function getVideoTitle(videoId) {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    );
    if (res.ok) {
      const data = await res.json();
      return data.title;
    }
  } catch {}
  return null;
}
