// api/resolve.js
// Resolves YouTube playlist URLs, channel URLs, and channel/@handle URLs
// into a list of video IDs. No API key needed — scrapes the page directly.
//
// Usage:
//   GET /api/resolve?url=https://www.youtube.com/playlist?list=PLxxxxx
//   GET /api/resolve?url=https://www.youtube.com/@channelname
//   GET /api/resolve?url=https://www.youtube.com/channel/UCxxxxx

export const config = {
  maxDuration: 30,
};

// Rate limiter — 5 requests per minute per IP
const rateMap = new Map();
const RATE_LIMIT = 5;
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

export default async function handler(req, res) {
  // CORS — restrict to same origin
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  const allowed = !origin || (function() { try { return new URL(origin).host === host; } catch { return false; } })();
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Rate limit
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded. Please wait a moment.' });
  }

  const url = req.query.url;
  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    // Determine URL type
    const playlistMatch = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    const channelMatch = url.match(/youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)/);
    const handleMatch = url.match(/youtube\.com\/@([a-zA-Z0-9_.-]+)/);
    const userMatch = url.match(/youtube\.com\/user\/([a-zA-Z0-9_.-]+)/);

    let videos = [];

    if (playlistMatch) {
      // ===== PLAYLIST =====
      videos = await resolvePlaylist(playlistMatch[1]);
    } else if (channelMatch || handleMatch || userMatch) {
      // ===== CHANNEL =====
      // First, resolve to a channel page and find the uploads playlist
      const channelUrl = channelMatch
        ? `https://www.youtube.com/channel/${channelMatch[1]}/videos`
        : handleMatch
          ? `https://www.youtube.com/@${handleMatch[1]}/videos`
          : `https://www.youtube.com/user/${userMatch[1]}/videos`;

      videos = await resolveChannel(channelUrl);
    } else {
      return res.status(400).json({
        error: 'URL must be a YouTube playlist, channel, or @handle URL',
      });
    }

    return res.status(200).json({
      count: videos.length,
      videos,
    });

  } catch (error) {
    console.error('Resolve error:', error);
    return res.status(500).json({ error: error.message || 'Failed to resolve URL' });
  }
}


// ===================================================================
// RESOLVE PLAYLIST — scrape playlist page for video IDs
// ===================================================================
async function resolvePlaylist(playlistId) {
  const url = `https://www.youtube.com/playlist?list=${playlistId}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch playlist page');
  }

  const html = await response.text();

  // Extract playlist title
  const titleMatch = html.match(/<title>(.*?)<\/title>/);
  const playlistTitle = titleMatch
    ? titleMatch[1].replace(' - YouTube', '').trim()
    : '';

  // Extract video IDs from the initial page data
  // YouTube embeds video data in a JSON object in the page source
  const videos = extractVideoIdsFromHTML(html);

  return videos.map(v => ({
    videoId: v.id,
    title: v.title,
    url: `https://www.youtube.com/watch?v=${v.id}`,
  }));
}


// ===================================================================
// RESOLVE CHANNEL — scrape channel /videos page
// ===================================================================
async function resolveChannel(channelUrl) {
  const response = await fetch(channelUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch channel page');
  }

  const html = await response.text();
  const videos = extractVideoIdsFromHTML(html);

  return videos.map(v => ({
    videoId: v.id,
    title: v.title,
    url: `https://www.youtube.com/watch?v=${v.id}`,
  }));
}


// ===================================================================
// EXTRACT VIDEO IDS from YouTube page HTML
// Uses multiple strategies to find as many video IDs as possible
// ===================================================================
function extractVideoIdsFromHTML(html) {
  const videos = new Map(); // Use Map to deduplicate by ID

  // Strategy 1: Find videoId entries in the ytInitialData JSON
  // This is the most reliable method — YouTube embeds all playlist/channel
  // data in a JSON object in a <script> tag
  const dataMatch = html.match(/var ytInitialData\s*=\s*(\{.*?\});\s*<\/script>/s);
  if (dataMatch) {
    try {
      const data = JSON.parse(dataMatch[1]);
      findVideoIds(data, videos);
    } catch (e) {
      // JSON parse failed, try other strategies
    }
  }

  // Strategy 2: Find all "videoId":"XXXXXXXXXXX" patterns
  const videoIdPattern = /"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/g;
  let match;
  while ((match = videoIdPattern.exec(html)) !== null) {
    if (!videos.has(match[1])) {
      videos.set(match[1], { id: match[1], title: '' });
    }
  }

  // Strategy 3: Find video titles associated with IDs
  // Pattern: "title":{"runs":[{"text":"VIDEO TITLE"}]}...followed by "videoId":"xxx"
  const titlePattern = /"title"\s*:\s*\{\s*"runs"\s*:\s*\[\s*\{\s*"text"\s*:\s*"([^"]+)"\s*\}\s*\]\s*\}/g;
  const titles = [];
  while ((match = titlePattern.exec(html)) !== null) {
    titles.push(match[1]);
  }

  // Try to associate titles with video IDs (best effort)
  const videoIdList = /"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/g;
  const ids = [];
  while ((match = videoIdList.exec(html)) !== null) {
    ids.push(match[1]);
  }

  // Deduplicated ID list
  const uniqueIds = [...new Set(ids)];
  for (let i = 0; i < uniqueIds.length; i++) {
    const id = uniqueIds[i];
    const existing = videos.get(id);
    if (existing && !existing.title && titles[i]) {
      existing.title = decodeHTMLEntities(titles[i]);
    } else if (!existing) {
      videos.set(id, { id, title: titles[i] ? decodeHTMLEntities(titles[i]) : '' });
    }
  }

  return Array.from(videos.values());
}


// ===================================================================
// RECURSIVE FINDER — walks the ytInitialData JSON tree
// ===================================================================
function findVideoIds(obj, videos, depth = 0) {
  if (depth > 15 || !obj || typeof obj !== 'object') return;

  // If this object has a videoId, capture it
  if (obj.videoId && typeof obj.videoId === 'string' && obj.videoId.length === 11) {
    const id = obj.videoId;
    if (!videos.has(id)) {
      // Try to find title nearby
      let title = '';
      if (obj.title) {
        if (typeof obj.title === 'string') title = obj.title;
        else if (obj.title.runs) title = obj.title.runs.map(r => r.text).join('');
        else if (obj.title.simpleText) title = obj.title.simpleText;
      }
      videos.set(id, { id, title: decodeHTMLEntities(title) });
    }
  }

  // Recurse into child objects/arrays
  if (Array.isArray(obj)) {
    for (const item of obj) findVideoIds(item, videos, depth + 1);
  } else {
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'object') {
        findVideoIds(obj[key], videos, depth + 1);
      }
    }
  }
}


function decodeHTMLEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\\u0026/g, '&')
    .replace(/\\"/g, '"');
}
