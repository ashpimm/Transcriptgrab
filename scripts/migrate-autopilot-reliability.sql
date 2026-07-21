-- Autopilot reliability migration (safe to run more than once).
-- Run with: node scripts/run-migration.mjs scripts/migrate-autopilot-reliability.sql

ALTER TABLE posts ADD COLUMN IF NOT EXISTS publish_claimed_at TIMESTAMPTZ;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS publish_run_id UUID;

CREATE TABLE IF NOT EXISTS autopilot_runs (
  id          UUID PRIMARY KEY,
  job         VARCHAR(20) NOT NULL,
  trigger     VARCHAR(30) NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'running',
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  stats       JSONB NOT NULL DEFAULT '{}',
  errors      JSONB NOT NULL DEFAULT '[]',
  duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_autopilot_runs_job_started
  ON autopilot_runs(job, started_at DESC);

CREATE TABLE IF NOT EXISTS autopilot_locks (
  job          VARCHAR(40) PRIMARY KEY,
  owner        UUID NOT NULL,
  locked_until TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posts_claimed
  ON posts(status, publish_claimed_at)
  WHERE publish_claimed_at IS NOT NULL;
