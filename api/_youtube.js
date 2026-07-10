// api/_youtube.js — YouTube Data API helpers + outlier scoring.
// Vercel ignores _-prefixed files in api/ as endpoints.
//
// The 5x rule: a video is a viral outlier when its views are at least
// 5x the account's follower count.

const API_BASE = 'https://www.googleapis.com/youtube/v3';

// ============================================
// PURE SCORING FUNCTIONS (unit tested)
// ============================================
export function computeOutlierScore(views, followers) {
  if (!followers || followers <= 0) return 0;
  const score = Math.round((views / followers) * 100) / 100;
  return Math.min(score, 9999.99);
}

export function isOutlier(views, followers) {
  if (!followers || followers <= 0) return false;
  // Raw ratio, not the rounded display score — 4.9999x must not round up to qualify.
  return views / followers >= 5;
}

// relevanceLanguage:'en' is only a hint to YouTube — Hindi/other-script videos
// still rank into results. Hard-reject titles whose letters aren't mostly Latin.
export function isMostlyLatin(text) {
  const letters = String(text || '').match(/\p{L}/gu) || [];
  if (letters.length === 0) return true;
  let latin = 0;
  for (const ch of letters) {
    if (/\p{Script=Latin}/u.test(ch)) latin++;
  }
  return latin / letters.length >= 0.8;
}

// ============================================
// YOUTUBE DATA API WRAPPERS
// ============================================
async function ytFetch(path, params, apiKey) {
  const qs = new URLSearchParams({ ...params, key: apiKey });
  const res = await fetch(`${API_BASE}/${path}?${qs}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`YouTube API ${path} error ${res.status}: ${body.substring(0, 200)}`);
  }
  return res.json();
}

/**
 * Search Shorts for a keyword, ordered by view count, last 18 months.
 * @returns {Promise<Array<{videoId, title, channelId}>>}
 */
export async function searchShorts(keyword, apiKey) {
  const publishedAfter = new Date(Date.now() - 18 * 30 * 24 * 3600 * 1000).toISOString();
  const data = await ytFetch('search', {
    part: 'snippet',
    q: keyword,
    type: 'video',
    videoDuration: 'short',
    order: 'viewCount',
    maxResults: '25',
    publishedAfter,
    relevanceLanguage: 'en',
  }, apiKey);

  return (data.items || [])
    .filter((it) => it.id?.videoId && isMostlyLatin(it.snippet?.title))
    .map((it) => ({
      videoId: it.id.videoId,
      title: it.snippet?.title || '',
      channelId: it.snippet?.channelId || '',
    }));
}

/**
 * Recent uploads from a channel (for seed creators).
 * @returns {Promise<Array<{videoId, title, channelId}>>}
 */
export async function channelRecentShorts(channelId, apiKey) {
  const data = await ytFetch('search', {
    part: 'snippet',
    channelId,
    type: 'video',
    videoDuration: 'short',
    order: 'viewCount',
    maxResults: '15',
  }, apiKey);

  return (data.items || [])
    .filter((it) => it.id?.videoId && isMostlyLatin(it.snippet?.title))
    .map((it) => ({
      videoId: it.id.videoId,
      title: it.snippet?.title || '',
      channelId: it.snippet?.channelId || channelId,
    }));
}

/**
 * Batch video statistics. Accepts up to 50 ids per call; chunks internally.
 * @returns {Promise<Map<videoId, {views, title, channelId}>>}
 */
export async function getVideoStats(videoIds, apiKey) {
  const out = new Map();
  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50);
    const data = await ytFetch('videos', {
      part: 'statistics,snippet',
      id: chunk.join(','),
    }, apiKey);
    for (const it of data.items || []) {
      out.set(it.id, {
        views: parseInt(it.statistics?.viewCount || '0', 10),
        title: it.snippet?.title || '',
        channelId: it.snippet?.channelId || '',
      });
    }
  }
  return out;
}

/**
 * Batch channel subscriber counts. Chunks by 50.
 * @returns {Promise<Map<channelId, {subscribers}>>}
 */
export async function getChannelStats(channelIds, apiKey) {
  const out = new Map();
  const unique = [...new Set(channelIds)].filter(Boolean);
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const data = await ytFetch('channels', {
      part: 'statistics',
      id: chunk.join(','),
    }, apiKey);
    for (const it of data.items || []) {
      out.set(it.id, {
        subscribers: parseInt(it.statistics?.subscriberCount || '0', 10),
      });
    }
  }
  return out;
}
