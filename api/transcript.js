// api/transcript.js
// Deploy on Vercel (free tier) as a serverless function.
//
// Uses Supadata API to fetch transcripts from YouTube, TikTok, Instagram, Facebook, X/Twitter.
// Set SUPADATA_API_KEY in Vercel environment variables.

import { getSession } from './_db.js';

const SUPADATA_KEY = process.env.SUPADATA_API_KEY || '';

// Allowed domains for video URLs
const ALLOWED_DOMAINS = [
  'youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com',
  'tiktok.com', 'www.tiktok.com', 'vm.tiktok.com',
  'instagram.com', 'www.instagram.com',
  'facebook.com', 'www.facebook.com', 'fb.watch', 'm.facebook.com',
  'x.com', 'www.x.com', 'twitter.com', 'www.twitter.com',
];

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

// =============================================================
// DETECT PLATFORM FROM URL
// =============================================================
function detectPlatform(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    if (hostname === 'youtube.com' || hostname === 'youtu.be' || hostname === 'm.youtube.com') return 'youtube';
    if (hostname === 'tiktok.com' || hostname === 'vm.tiktok.com') return 'tiktok';
    if (hostname === 'instagram.com') return 'instagram';
    if (hostname === 'facebook.com' || hostname === 'fb.watch' || hostname === 'm.facebook.com') return 'facebook';
    if (hostname === 'x.com' || hostname === 'twitter.com') return 'twitter';
  } catch {}
  return null;
}

// =============================================================
// VALIDATE URL AGAINST ALLOWLIST
// =============================================================
function isAllowedUrl(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return ALLOWED_DOMAINS.includes(hostname);
  } catch {
    return false;
  }
}

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

  // Accept ?url= (full URL) or ?v= (legacy YouTube ID)
  let videoUrl = req.query.url || '';
  const legacyId = req.query.v || '';

  if (!videoUrl && legacyId) {
    if (/^[a-zA-Z0-9_-]{11}$/.test(legacyId)) {
      videoUrl = `https://www.youtube.com/watch?v=${legacyId}`;
    } else {
      return res.status(400).json({ error: 'Invalid video ID' });
    }
  }

  if (!videoUrl) {
    return res.status(400).json({ error: 'Missing video URL. Use ?url= or ?v= parameter.' });
  }

  if (!isAllowedUrl(videoUrl)) {
    return res.status(400).json({ error: 'Unsupported platform. Supported: YouTube, TikTok, Instagram, Facebook, X/Twitter.' });
  }

  const platform = detectPlatform(videoUrl);
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
    let result = await fetchTranscript(videoUrl, platform);

    // Retry once on transient failures (Supadata can be flaky on first request)
    if (!result.success && !result.noCaptions && !result.async) {
      await new Promise(r => setTimeout(r, 1500));
      result = await fetchTranscript(videoUrl, platform);
    }

    // Handle 202 async (Supadata processing large videos)
    if (result.async) {
      return res.status(202).json({
        async: true,
        message: 'This video is being processed. Please try again in a few seconds.',
        platform,
      });
    }

    if (result.success) {
      return res.status(200).json({
        ...result.data,
        platform,
        source: 'supadata',
      });
    }

    return res.status(404).json({
      error: result.error,
      no_captions: result.noCaptions || false,
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
async function fetchTranscript(videoUrl, platform) {
  try {
    const res = await fetch(
      `https://api.supadata.ai/v1/transcript?url=${encodeURIComponent(videoUrl)}`,
      { headers: { 'x-api-key': SUPADATA_KEY } }
    );

    // Handle 202 async processing
    if (res.status === 202) {
      return { success: false, async: true };
    }

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
      return { success: false, noCaptions: true, error: 'This video doesn\'t have captions available.' };
    }

    const segments = rawSegments
      .filter(s => s.text?.trim())
      .map(s => ({
        start: (s.offset != null ? s.offset / 1000 : parseFloat(s.start)) || 0,
        duration: (s.duration != null ? s.duration / 1000 : parseFloat(s.dur)) || 0,
        text: s.text.trim(),
      }));

    if (segments.length === 0) {
      return { success: false, noCaptions: true, error: 'This video doesn\'t have captions available.' };
    }

    const title = await getVideoTitle(videoUrl, platform) || `Video`;
    const lang = rawSegments[0]?.lang || 'en';
    console.log(`Supadata (${platform}): success, ${segments.length} segments, lang=${lang}`);

    return {
      success: true,
      data: {
        title,
        videoUrl,
        platform,
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
// HELPER: Get video title via oEmbed (YouTube, TikTok) or fallback
// =============================================================
async function getVideoTitle(videoUrl, platform) {
  try {
    if (platform === 'youtube') {
      const res = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`
      );
      if (res.ok) {
        const data = await res.json();
        return data.title;
      }
    }

    if (platform === 'tiktok') {
      const res = await fetch(
        `https://www.tiktok.com/oembed?url=${encodeURIComponent(videoUrl)}`
      );
      if (res.ok) {
        const data = await res.json();
        return data.title;
      }
    }

    if (platform === 'instagram') {
      return 'Instagram video';
    }
    if (platform === 'facebook') {
      return 'Facebook video';
    }
    if (platform === 'twitter') {
      return 'X post';
    }
  } catch {}
  return null;
}
