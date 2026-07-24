// tests/analytics.test.mjs — the pure transforms behind the "Measure" loop:
// normalizing upload-post's (undocumented, shape-varying) analytics payloads
// into per-platform rows, aggregating totals, and deciding what to re-sync.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractMetrics, normalizePostAnalytics, hasAnyMetric, sumMetrics, aggregateTotals,
  shouldSyncPost, requestIdForPost, sumProfileFollowers, METRIC_KEYS,
} from '../api/_analytics.js';

// ---- extractMetrics: alias mapping + coercion ----

test('extractMetrics maps platform-specific aliases onto canonical metrics', () => {
  const m = extractMetrics({ play_count: 1200, digg_count: 88, comment_count: 4, share_count: 9, collect_count: 3 });
  assert.equal(m.views, 1200);
  assert.equal(m.likes, 88);
  assert.equal(m.comments, 4);
  assert.equal(m.shares, 9);
  assert.equal(m.saves, 3);
});

test('extractMetrics is case-insensitive and coerces numeric strings with commas', () => {
  const m = extractMetrics({ Views: '1,204', Likes: '56' });
  assert.equal(m.views, 1204);
  assert.equal(m.likes, 56);
});

test('extractMetrics defaults every metric to 0 and ignores junk', () => {
  const m = extractMetrics({ nonsense: 'x' });
  for (const k of METRIC_KEYS) assert.equal(m[k], 0);
  assert.equal(extractMetrics(null).views, 0);
});

// ---- normalizePostAnalytics: the shape zoo ----

test('normalize: results array keyed per platform', () => {
  const rows = normalizePostAnalytics({
    results: [
      { platform: 'instagram', post_metrics: { views: 900, like_count: 40 }, post_url: 'https://ig/p/1' },
      { platform: 'tiktok', post_metrics: { play_count: 5000, digg_count: 300 } },
    ],
  });
  assert.equal(rows.length, 2);
  const ig = rows.find((r) => r.platform === 'instagram');
  assert.equal(ig.metrics.views, 900);
  assert.equal(ig.metrics.likes, 40);
  assert.equal(ig.postUrl, 'https://ig/p/1');
  assert.equal(rows.find((r) => r.platform === 'tiktok').metrics.views, 5000);
});

test('normalize: results as an object keyed by platform', () => {
  const rows = normalizePostAnalytics({
    results: { instagram: { views: 10, likes: 2 }, youtube: { views: 40 } },
  });
  assert.deepEqual(rows.map((r) => r.platform).sort(), ['instagram', 'youtube']);
});

test('normalize: post_metrics keyed by platform', () => {
  const rows = normalizePostAnalytics({
    post_url: 'https://x/1', platform_post_id: 'abc',
    post_metrics: { instagram: { views: 3 }, tiktok: { views: 7 } },
  });
  assert.equal(rows.length, 2);
  // the shared top-level url/id propagate to each platform entry
  assert.equal(rows[0].postUrl, 'https://x/1');
  assert.equal(rows[0].platformPostId, 'abc');
});

test('normalize: single flat result, platform named on the payload', () => {
  const rows = normalizePostAnalytics({
    platform: 'instagram', platform_post_id: '17900', post_url: 'https://ig/p/9',
    post_metrics: { views: 120, like_count: 8, comment_count: 1, share_count: 2 },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].platform, 'instagram');
  assert.equal(rows[0].metrics.likes, 8);
  assert.equal(rows[0].platformPostId, '17900');
});

test('normalize: unlabelled single entry is named from the post platforms', () => {
  const rows = normalizePostAnalytics({ post_metrics: { views: 5 } }, ['instagram']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].platform, 'instagram');
});

test('normalize: unlabelled entry with several fallback platforms is dropped (ambiguous)', () => {
  const rows = normalizePostAnalytics({ post_metrics: { views: 5 } }, ['instagram', 'tiktok']);
  assert.equal(rows.length, 0);
});

test('normalize: empty / garbage payloads yield no rows', () => {
  assert.deepEqual(normalizePostAnalytics(null), []);
  assert.deepEqual(normalizePostAnalytics({}), []);
  assert.deepEqual(normalizePostAnalytics({ results: [] }), []);
});

// ---- aggregation ----

test('sumMetrics adds per-platform rows (strings from pg BIGINT included)', () => {
  const total = sumMetrics([
    { views: '900', likes: 40, comments: 4, shares: 9 },
    { views: 5000, likes: 300, comments: 20, shares: 11 },
  ]);
  assert.equal(total.views, 5900);
  assert.equal(total.likes, 340);
  assert.equal(total.shares, 20);
});

test('aggregateTotals only counts posts that actually have metric rows', () => {
  const totals = aggregateTotals([
    { metrics: [{ views: 100, likes: 10 }] },
    { metrics: [] },
    { metrics: [{ views: 50, likes: 5 }, { views: 25, likes: 1 }] },
    { status: 'queued' },
  ]);
  assert.equal(totals.views, 175);
  assert.equal(totals.likes, 16);
  assert.equal(totals.measuredPosts, 2);
});

test('hasAnyMetric', () => {
  assert.equal(hasAnyMetric({ views: 0, likes: 0 }), false);
  assert.equal(hasAnyMetric({ views: 0, likes: 3 }), true);
});

// ---- sync gating ----

const NOW = new Date('2026-07-24T00:00:00Z');

test('shouldSyncPost: only posted posts', () => {
  assert.equal(shouldSyncPost({ status: 'queued', scheduled_at: '2026-07-23T00:00:00Z' }, NOW), false);
  assert.equal(shouldSyncPost({ status: 'posted', scheduled_at: '2026-07-23T00:00:00Z', metrics_synced_at: null }, NOW), true);
});

test('shouldSyncPost: never-synced posted post is due', () => {
  assert.equal(shouldSyncPost({ status: 'posted', scheduled_at: '2026-07-23T00:00:00Z' }, NOW), true);
});

test('shouldSyncPost: fresh sync is not due, stale sync is', () => {
  const fresh = { status: 'posted', scheduled_at: '2026-07-23T00:00:00Z', metrics_synced_at: '2026-07-23T22:00:00Z' };
  const stale = { status: 'posted', scheduled_at: '2026-07-23T00:00:00Z', metrics_synced_at: '2026-07-23T10:00:00Z' };
  assert.equal(shouldSyncPost(fresh, NOW), false); // 2h ago < 6h
  assert.equal(shouldSyncPost(stale, NOW), true);  // 14h ago > 6h
});

test('shouldSyncPost: posts older than the max age are left alone', () => {
  const old = { status: 'posted', scheduled_at: '2026-05-01T00:00:00Z', metrics_synced_at: null };
  assert.equal(shouldSyncPost(old, NOW), false);
});

test('shouldSyncPost: forced (staleMs 0) re-syncs even a just-synced post', () => {
  const justSynced = { status: 'posted', scheduled_at: '2026-07-23T00:00:00Z', metrics_synced_at: '2026-07-23T23:59:00Z' };
  assert.equal(shouldSyncPost(justSynced, NOW, 0), true);
});

// ---- request id + profile followers ----

test('requestIdForPost prefers stored id, falls back to the deterministic one', () => {
  assert.equal(requestIdForPost({ id: 5, external_ids: { request_id: 'hooklab-post-5' } }), 'hooklab-post-5');
  assert.equal(requestIdForPost({ id: 9 }), 'hooklab-post-9');
  assert.equal(requestIdForPost({ id: 9, external_ids: {} }), 'hooklab-post-9');
});

test('sumProfileFollowers across platform-keyed results', () => {
  assert.equal(sumProfileFollowers({ results: { instagram: { followers: 1200 }, tiktok: { follower_count: 300 } } }), 1500);
  assert.equal(sumProfileFollowers({ instagram: { followers: 50 }, tiktok: { subscribers: 10 } }), 60);
  assert.equal(sumProfileFollowers({ followers: 42 }), 42);
  assert.equal(sumProfileFollowers({}), 0);
  assert.equal(sumProfileFollowers(null), 0);
});
