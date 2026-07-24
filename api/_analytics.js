// api/_analytics.js — pure transforms for the "Measure" loop. No network, no DB,
// so every branch is unit-testable. The network client lives in _uploadpost.js;
// the endpoint (api/analytics.js) glues them together.
// Vercel ignores _-prefixed files in api/ as endpoints.

export const METRIC_KEYS = ['views', 'likes', 'comments', 'shares', 'saves', 'reach', 'impressions'];

// upload-post normalizes across platforms but the field names still vary by
// source (TikTok uses digg_count/play_count, IG uses like_count, X uses
// retweet_count...). Map every alias we know onto one canonical metric. Keys are
// matched case-insensitively.
const ALIASES = {
  views:       ['views', 'view_count', 'video_views', 'plays', 'play_count', 'video_view_count'],
  likes:       ['likes', 'like_count', 'likes_count', 'favorites', 'favorite_count', 'digg_count', 'reactions', 'reaction_count'],
  comments:    ['comments', 'comment_count', 'comments_count', 'reply_count', 'replies'],
  shares:      ['shares', 'share_count', 'shares_count', 'reposts', 'repost_count', 'retweet_count', 'retweets'],
  saves:       ['saves', 'save_count', 'saved', 'bookmark_count', 'bookmarks', 'collect_count'],
  reach:       ['reach', 'accounts_reached', 'unique_views'],
  impressions: ['impressions', 'impression_count', 'total_impressions'],
};

const KNOWN_ALIAS_SET = new Set(Object.values(ALIASES).flat());

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const n = Number(value.replace(/[, ]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

// A metrics container maps canonical metric -> number, reading the first alias
// present. Case-insensitive so PascalCase / snake_case providers both land.
export function extractMetrics(container) {
  const src = container && typeof container === 'object' ? container : {};
  const lower = {};
  for (const key of Object.keys(src)) lower[key.toLowerCase()] = src[key];
  const out = {};
  for (const metric of METRIC_KEYS) {
    let value = 0;
    for (const alias of ALIASES[metric]) {
      if (lower[alias] != null) { value = toNumber(lower[alias]); break; }
    }
    out[metric] = value;
  }
  return out;
}

// Does this object look like a flat bag of metrics (views/likes/...) rather than
// a map keyed by platform name? Used to tell "post_metrics: {views,likes}" apart
// from "post_metrics: {instagram:{...}, tiktok:{...}}".
function looksLikeMetrics(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  return Object.keys(obj).some((k) => KNOWN_ALIAS_SET.has(k.toLowerCase()));
}

function containerToEntry(platform, container) {
  if (!container || typeof container !== 'object') return null;
  const metricsSource = looksLikeMetrics(container.post_metrics) ? container.post_metrics
    : looksLikeMetrics(container.metrics) ? container.metrics
    : container;
  const platformName = String(platform || container.platform || '').toLowerCase().trim();
  return {
    platform: platformName,
    metrics: extractMetrics(metricsSource),
    postUrl: container.post_url || container.url || container.permalink || container.share_url || '',
    platformPostId: String(container.platform_post_id || container.post_id || container.id || ''),
    error: container.post_metrics_error || container.error || '',
  };
}

// Turn one upload-post post-analytics response into one row per platform.
// The provider's exact shape isn't documented, so accept: a `results` array or
// platform-keyed object, a platform-keyed `post_metrics`, or a single flat
// result. `fallbackPlatforms` names the platform when the payload omits it
// (e.g. a single-platform post whose response carries only bare metrics).
export function normalizePostAnalytics(data, fallbackPlatforms = []) {
  if (!data || typeof data !== 'object') return [];
  const entries = [];

  const results = data.results;
  if (Array.isArray(results)) {
    for (const r of results) entries.push(containerToEntry(r?.platform, r));
  } else if (results && typeof results === 'object') {
    for (const [k, v] of Object.entries(results)) entries.push(containerToEntry(k, v));
  }

  // Platform-keyed post_metrics (values are per-platform metric bags).
  if (!entries.length && data.post_metrics && typeof data.post_metrics === 'object'
      && !Array.isArray(data.post_metrics) && !looksLikeMetrics(data.post_metrics)) {
    for (const [k, v] of Object.entries(data.post_metrics)) {
      entries.push(containerToEntry(k, {
        post_metrics: v, post_url: data.post_url, platform_post_id: data.platform_post_id,
      }));
    }
  }

  // Single flat result (top-level metrics / post_metrics is a flat bag).
  if (!entries.length) entries.push(containerToEntry(data.platform, data));

  const cleaned = entries.filter(Boolean);
  // Name an unlabelled single entry from the platforms we shipped it to.
  if (cleaned.length === 1 && !cleaned[0].platform && fallbackPlatforms.length === 1) {
    cleaned[0].platform = String(fallbackPlatforms[0]).toLowerCase();
  }
  // Keep only rows that are usable: a known platform, or at least some signal.
  return cleaned.filter((e) => e.platform && (hasAnyMetric(e.metrics) || e.postUrl || e.platformPostId));
}

export function hasAnyMetric(metrics) {
  return METRIC_KEYS.some((k) => (metrics?.[k] || 0) > 0);
}

// Sum an array of per-platform metric rows into one total for a single post.
export function sumMetrics(rows) {
  const total = {};
  for (const k of METRIC_KEYS) total[k] = 0;
  for (const row of rows || []) {
    for (const k of METRIC_KEYS) total[k] += toNumber(row?.[k]);
  }
  return total;
}

// Roll every post's metrics into account-wide totals for the dashboard header.
// `posts` are rows shaped like getPostsWithMetrics returns: each has a
// `metrics` array. Only posts that have at least one metric row are counted as
// "measured".
export function aggregateTotals(posts) {
  const totals = {};
  for (const k of METRIC_KEYS) totals[k] = 0;
  let measuredPosts = 0;
  for (const post of posts || []) {
    const rows = Array.isArray(post?.metrics) ? post.metrics : [];
    if (!rows.length) continue;
    measuredPosts++;
    const s = sumMetrics(rows);
    for (const k of METRIC_KEYS) totals[k] += s[k];
  }
  return { ...totals, measuredPosts };
}

// Should we spend an upload-post call refreshing this post's numbers right now?
// Only posts that actually published, are recent enough to still be gaining
// engagement, and whose cached numbers are stale (or never fetched).
export function shouldSyncPost(post, now = new Date(), staleMs = 6 * 60 * 60 * 1000, maxAgeMs = 45 * 24 * 60 * 60 * 1000) {
  if (!post || post.status !== 'posted') return false;
  const scheduled = new Date(post.scheduled_at).getTime();
  if (Number.isFinite(scheduled) && now.getTime() - scheduled > maxAgeMs) return false;
  if (!post.metrics_synced_at) return true;
  const synced = new Date(post.metrics_synced_at).getTime();
  if (!Number.isFinite(synced)) return true;
  return now.getTime() - synced >= staleMs;
}

const FOLLOWER_ALIASES = ['followers', 'follower_count', 'followers_count', 'fans', 'subscriber_count', 'subscribers'];

function followersIn(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const lower = {};
  for (const k of Object.keys(obj)) lower[k.toLowerCase()] = obj[k];
  for (const a of FOLLOWER_ALIASES) if (lower[a] != null) return toNumber(lower[a]);
  return null;
}

// Total followers across a profile-analytics payload. The endpoint shape is
// undocumented, so read from the first source that yields platform containers:
// a `results`/`analytics` map, else top-level platform-keyed objects, else a
// flat object. Returns 0 when nothing looks like a follower count.
export function sumProfileFollowers(data) {
  if (!data || typeof data !== 'object') return 0;
  let containers = [];
  if (data.results && typeof data.results === 'object') containers = Object.values(data.results);
  else if (data.analytics && typeof data.analytics === 'object') containers = Object.values(data.analytics);
  else {
    const nested = Object.values(data).filter((v) => v && typeof v === 'object' && !Array.isArray(v) && followersIn(v) !== null);
    containers = nested.length ? nested : [data];
  }
  let total = 0; let found = false;
  for (const c of containers) {
    const f = followersIn(c);
    if (f !== null) { total += f; found = true; }
  }
  return found ? total : 0;
}

// The stable provider request id we published under, recomputed if the stored
// external_ids somehow lost it. Mirrors _autopilot-runner.js's requestId.
export function requestIdForPost(post) {
  return post?.external_ids?.request_id || `hooklab-post-${post?.id}`;
}
