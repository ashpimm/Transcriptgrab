// api/social.js — Autopilot/account companion: social account linking, the
// post queue AND its user controls (toggle, posting slot, edit/skip), and the
// "Measure" analytics loop. All in one file to stay under the Vercel Hobby
// 12-function limit.
//
// GET  /api/social                          -> { enabled, connected, username, linked, posts, queue, health }
// GET  /api/social?resource=analytics       -> { enabled, connected, totals, posts, syncedAt }  (cached, fast)
// GET  /api/social?resource=autopilot       -> GET payload + { autopilotOn, postSlot, slots }
// POST /api/social {action:'link'}          -> { url } (hosted upload-post linking page)
// POST /api/social {action:'refresh-analytics'} -> pull fresh numbers, save, return updated set
// POST /api/social {action:'toggle', enabled}   -> autopilot on/off
// POST /api/social {action:'set-slot', slot}    -> posting time (allowed cron slots only)
// POST /api/social {action:'edit-post', postId, slides, caption} -> manual queue edit
// POST /api/social {action:'skip-post', postId} -> skip a queued post

import {
  getSession, setUploadPostUsername, getPostsForUser, getPostQueueSummary,
  getLatestAutopilotRuns, ensureAnalyticsSchema, getPostsWithMetrics,
  getPostsForMetricSync, savePostMetrics, ensureAutopilotReliabilitySchema,
  setAutopilotEnabled, setPostSlot, updateQueuedPost, skipQueuedPost,
} from './_db.js';
import {
  PUBLISH_SLOTS, DEFAULT_SLOT, isAllowedSlot, validatePostEdit,
} from './_autopilot-controls.js';
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
      const wantsAutopilot = req.query?.resource === 'autopilot';
      if (wantsAutopilot) await ensureAutopilotReliabilitySchema();
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
      const payload = {
        enabled: uploadPostEnabled(),
        connected: !!user.upload_post_username,
        username: user.upload_post_username || '',
        linked,
        posts,
        queue,
        health: publicAutopilotHealth(healthRows),
      };
      if (wantsAutopilot) {
        // Column missing pre-migration reads as undefined -> treat as defaults.
        payload.autopilotOn = user.autopilot_enabled !== false;
        payload.postSlot = isAllowedSlot(user.post_slot) ? user.post_slot : DEFAULT_SLOT;
        payload.slots = PUBLISH_SLOTS;
        payload.tier = user.tier || 'free';
      }
      return res.status(200).json(payload);
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

    // ---- autopilot controls (pro-only; the page itself upsells free users) ----
    if (['toggle', 'set-slot', 'edit-post', 'skip-post'].includes(body.action)) {
      if (user.tier !== 'pro') {
        return res.status(402).json({ error: 'Autopilot is included with Pro ($19/month).', upgrade: true });
      }
      await ensureAutopilotReliabilitySchema();

      if (body.action === 'toggle') {
        const on = !!body.enabled;
        await setAutopilotEnabled(user.id, on);
        return res.status(200).json({ autopilotOn: on });
      }

      if (body.action === 'set-slot') {
        if (!isAllowedSlot(body.slot)) {
          return res.status(400).json({ error: 'Pick one of the available posting times.' });
        }
        await setPostSlot(user.id, body.slot);
        return res.status(200).json({ postSlot: body.slot });
      }

      const postId = parseInt(body.postId, 10);
      if (!Number.isInteger(postId) || postId <= 0) {
        return res.status(400).json({ error: 'Missing post id.' });
      }

      if (body.action === 'edit-post') {
        const checked = validatePostEdit(body);
        if (checked.error) return res.status(400).json({ error: checked.error });
        const updated = await updateQueuedPost(user.id, postId, checked.slides, checked.caption);
        if (!updated) {
          return res.status(409).json({ error: 'This post is no longer editable — it may already be publishing.' });
        }
        return res.status(200).json({ post: updated });
      }

      if (body.action === 'skip-post') {
        const skipped = await skipQueuedPost(user.id, postId);
        if (!skipped) {
          return res.status(409).json({ error: 'This post can no longer be skipped — it may already be publishing.' });
        }
        return res.status(200).json({ skipped: true });
      }
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
