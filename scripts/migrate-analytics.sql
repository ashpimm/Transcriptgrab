-- scripts/migrate-analytics.sql — "Measure" loop: per-post performance metrics
-- pulled back from upload-post and stored against the exact post that earned them.
-- Run with: node scripts/run-migration.mjs scripts/migrate-analytics.sql
--
-- One row per (post, platform): the LATEST snapshot, upserted on every sync.
-- A full time-series was deliberately skipped for v1 — latest-per-platform is
-- enough to rank posts and drive the account dashboard, and keeps writes cheap.

CREATE TABLE IF NOT EXISTS post_metrics (
  post_id          INTEGER     NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  platform         VARCHAR(30) NOT NULL,
  views            BIGINT      NOT NULL DEFAULT 0,
  likes            BIGINT      NOT NULL DEFAULT 0,
  comments         BIGINT      NOT NULL DEFAULT 0,
  shares           BIGINT      NOT NULL DEFAULT 0,
  saves            BIGINT      NOT NULL DEFAULT 0,
  reach            BIGINT      NOT NULL DEFAULT 0,
  impressions      BIGINT      NOT NULL DEFAULT 0,
  post_url         TEXT        NOT NULL DEFAULT '',
  platform_post_id TEXT        NOT NULL DEFAULT '',
  raw              JSONB       NOT NULL DEFAULT '{}',
  captured_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_post_metrics_post ON post_metrics(post_id);

-- When we last pulled analytics for a post (NULL = never). Drives stale-gating
-- so a page load never re-hammers upload-post for fresh-enough numbers.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS metrics_synced_at TIMESTAMPTZ;
