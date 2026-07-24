// api/social.js — Account-page companion: social account linking, the post
// queue, AND the "Measure" analytics loop. Analytics lives here rather than in
// its own file to stay under the Vercel Hobby 12-function limit.
//
// GET  /api/social                          -> { enabled, connected, username, linked, posts, queue, health }
// GET  /api/social?resource=analytics       -> { enabled, connected, totals, posts, syncedAt }  (cached, fast)
// POST /api/social {action:'link'}          -> { url } (hosted upload-post linking page)
// POST /api/social {action:'refresh-analytics'} -> pull fresh numbers, save, return updated set

import {
  getSession, setUploadPostUsername, getPostsForUser, getPostQueueSummary,
  getLatestAutopilotRuns, ensureAnalyticsSchema, getPostsWithMetrics,
  getPostsForMetricSync, savePostMetrics,
} from './_db.js';
import {
  uploadPostEnabled, createUploadPostUser, generateLinkUrl, getLinkedPlatforms,
  getPostAnalytics, getProfileAnalytics,
} from './_uploadpost.js';
import { publicAutopilotHealth } from './_autopilot-health.js';
import {
  aggregateTotals, normalizePostAnalytics, shouldSyncPost, requestIdForPost, sumProfileFollowers,
} from './_analytics.js';

const HISTORY_LIMIT = 30;
const MAX_SYNC_PER_REFRESH = 8;
const DEFAULT_STALE_MS = 6 * 60 * 60 * 1000; // 6h
const FORCED_STALE_MS = 15 * 60 * 1000;      // manual button still won't spam a fresh post

function cors(req, res) {
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  const allowed = !origin || (function () { try { return new URL(origin).host === host; } catch { return false; } })();
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') { res.status(200).end(); return true; }
  return false;
}

// ---- analytics helpers ----

function latestSync(posts) {
  let latest = null;
  for (const p of posts) {
    if (!p.metrics_synced_at) continue;
    const t = new Date(p.metrics_synced_at).getTime();
    if (Number.isFinite(t) && (latest === null || t > latest)) latest = t;
  }
  return latest ? new Date(latest).toISOString() : null;
}

async function cachedAnalytics(user) {
  const posts = await getPostsWithMetrics(user.id, HISTORY_LIMIT);
  return {
    enabled: uploadPostEnabled(),
    connected: !!user.upload_post_username,
    totals: aggregateTotals(posts),
    posts,
    syncedAt: latestSync(posts),
  };
}

// Pull fresh per-post numbers for stale-but-recent posted posts, in parallel and
// best-effort: one provider hiccup must not fail the whole refresh.
async function refreshMetrics(user, { force }) {
  const candidates = await getPostsForMetricSync(user.id, 40);
  const now = new Date();
  const staleMs = force ? FORCED_STALE_MS : DEFAULT_STALE_MS;
  const due = candidates.filter((p) => shouldSyncPost(p, now, staleMs)).slice(0, MAX_SYNC_PER_REFRESH);

  const results = await Promise.allSettled(due.map(async (post) => {
    const data = await getPostAnalytics(requestIdForPost(post));
    const rows = normalizePostAnalytics(data, post.platforms || []);
    await savePostMetrics(post.id, rows);
  }));
  const synced = results.filter((r) => r.status === 'fulfilled').length;

  // Profile-level followers for the header strip — a bonus, never fatal.
  let followers = 0;
  try {
    const linked = await getLinkedPlatforms(user.upload_post_username).catch(() => null);
    const platforms = Array.isArray(linked) && linked.length ? linked : ['instagram'];
    followers = sumProfileFollowers(await getProfileAnalytics(user.upload_post_username, platforms));
  } catch { /* leave followers 0 */ }

  return { synced, attempted: due.length, followers };
}

export default async function handler(req, res) {
  if (cors(req, res)) return;

  try {
    const user = await getSession(req).catch(() => null);
    if (!user) return res.status(401).json({ error: 'Sign in required.' });

    // ---- analytics: read (cached) ----
    if (req.method === 'GET' && req.query?.resource === 'analytics') {
      await ensureAnalyticsSchema();
      return res.status(200).json(await cachedAnalytics(user));
    }

    if (req.method === 'GET') {
      const [posts, queue, healthRows] = await Promise.all([
        getPostsForUser(user.id),
        getPostQueueSummary(user.id),
        getLatestAutopilotRuns().catch(() => []),
      ]);
      // linked: platform names actually connected at upload-post, null = unknown
      // (lookup failed or response shape unrecognized) — page falls back to a
      // plain "Connected" line rather than claiming platforms it can't verify.
      let linked = null;
      if (user.upload_post_username && uploadPostEnabled()) {
        linked = await getLinkedPlatforms(user.upload_post_username).catch(() => null);
      }
      return res.status(200).json({
        enabled: uploadPostEnabled(),
        connected: !!user.upload_post_username,
        username: user.upload_post_username || '',
        linked,
        posts,
        queue,
        health: publicAutopilotHealth(healthRows),
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

    if (body.action === 'link') {
      if (user.tier !== 'pro') {
        return res.status(402).json({ error: 'Daily Instagram publishing is included with Pro ($19/month). Upgrade to connect your account.', upgrade: true });
      }
      if (!uploadPostEnabled()) {
        return res.status(503).json({ error: 'Instagram connection is temporarily unavailable. Download and publish your post manually for now.' });
      }
      const username = user.upload_post_username || `hooklab-u${user.id}`;
      await createUploadPostUser(username);
      if (!user.upload_post_username) await setUploadPostUsername(user.id, username);
      const url = await generateLinkUrl(username);
      return res.status(200).json({ url });
    }

    // ---- analytics: refresh (network) ----
    if (body.action === 'refresh-analytics') {
      await ensureAnalyticsSchema();
      // Nothing to pull if never connected or the provider is off — hand back
      // the cache so the page still renders its history.
      if (!user.upload_post_username || !uploadPostEnabled()) {
        return res.status(200).json({ ...(await cachedAnalytics(user)), refreshed: false });
      }
      const refresh = await refreshMetrics(user, { force: !!body.force });
      const payload = await cachedAnalytics(user);
      return res.status(200).json({ ...payload, refreshed: true, ...refresh });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    console.error('social error:', e);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
