-- scripts/migrate-autopilot.sql — Autopilot pivot (2026-07-13 spec)
-- Run with: node scripts/run-migration.mjs scripts/migrate-autopilot.sql

-- Free tier: 1 -> 3 carousels ever
ALTER TABLE users ADD COLUMN IF NOT EXISTS free_carousels_used INTEGER DEFAULT 0;
UPDATE users SET free_carousels_used = 1
WHERE free_carousel_used = TRUE AND COALESCE(free_carousels_used, 0) = 0;

-- upload-post.com linked profile name (NULL = not connected)
ALTER TABLE users ADD COLUMN IF NOT EXISTS upload_post_username VARCHAR(100);

-- Content calendar
CREATE TABLE IF NOT EXISTS posts (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'queued',  -- queued|publishing|submitted|verifying|posted|blocked|failed|skipped
  kind         VARCHAR(20) NOT NULL DEFAULT 'value',   -- value|showcase
  style        VARCHAR(50) DEFAULT 'bold',
  slides       JSONB NOT NULL,                          -- [{index, heading, body}]
  caption      TEXT DEFAULT '',
  accent       VARCHAR(7) DEFAULT '',
  motifs       JSONB DEFAULT '[]',
  platforms    TEXT[] NOT NULL DEFAULT '{tiktok,instagram}',
  external_ids JSONB,
  error        TEXT DEFAULT '',
  retries      INTEGER DEFAULT 0,
  publish_claimed_at TIMESTAMPTZ,
  publish_run_id UUID,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_posts_due  ON posts(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, scheduled_at DESC);

-- Durable evidence for every scheduler invocation. This is intentionally
-- separate from Vercel logs so the Account page and /api/health can report
-- whether the worker ran even after log retention expires.
CREATE TABLE IF NOT EXISTS autopilot_runs (
  id          UUID PRIMARY KEY,
  job         VARCHAR(20) NOT NULL, -- publish|topup
  trigger     VARCHAR(30) NOT NULL, -- primary|recovery|manual
  status      VARCHAR(20) NOT NULL DEFAULT 'running',
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  stats       JSONB NOT NULL DEFAULT '{}',
  errors      JSONB NOT NULL DEFAULT '[]',
  duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_autopilot_runs_job_started
  ON autopilot_runs(job, started_at DESC);

-- Prevent a flexible-window primary cron and its recovery cron from topping
-- up the same customer concurrently.
CREATE TABLE IF NOT EXISTS autopilot_locks (
  job          VARCHAR(40) PRIMARY KEY,
  owner        UUID NOT NULL,
  locked_until TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
