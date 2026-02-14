// api/resolve.js
// Resolves YouTube playlist URLs, channel URLs, and channel/@handle URLs
// into a list of video IDs. No API key needed — scrapes the page directly.
//
// Usage:
//   GET /api/resolve?url=https://www.youtube.com/playlist?list=PLxxxxx
//   GET /api/resolve?url=https://www.youtube.com/@channelname
//   GET /api/resolve?url=https://www.youtube.com/channel/UCxxxxx

import { resolvePlaylist, resolveChannel } from './_resolve.js';

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
