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
  status       VARCHAR(20) NOT NULL DEFAULT 'queued',  -- queued|posted|failed|skipped
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
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_posts_due  ON posts(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, scheduled_at DESC);
