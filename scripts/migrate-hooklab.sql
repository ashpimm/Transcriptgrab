-- HOOKLAB MIGRATION
-- Run once in the Neon console (or via scripts/run-migration.mjs).

CREATE TABLE niches (
  id          SERIAL PRIMARY KEY,
  slug        VARCHAR(50) UNIQUE NOT NULL,
  name        VARCHAR(100) NOT NULL,
  keywords    TEXT[] NOT NULL DEFAULT '{}',
  seed_channels TEXT[] NOT NULL DEFAULT '{}',
  active      BOOLEAN DEFAULT TRUE,
  last_mined_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE hooks (
  id            SERIAL PRIMARY KEY,
  niche_id      INTEGER NOT NULL REFERENCES niches(id) ON DELETE CASCADE,
  hook_template TEXT NOT NULL,
  hook_verbatim TEXT DEFAULT '',
  topic         VARCHAR(300) DEFAULT '',
  format        VARCHAR(30) DEFAULT 'talking_head',  -- talking_head|whiteboard|audio_broll|skit|other
  platform      VARCHAR(20) DEFAULT 'youtube',
  video_url     VARCHAR(512) NOT NULL,
  video_title   VARCHAR(500) DEFAULT '',
  views         BIGINT DEFAULT 0,
  followers     BIGINT DEFAULT 0,
  outlier_score NUMERIC(8,2) DEFAULT 0,              -- views / followers
  curated       BOOLEAN DEFAULT FALSE,
  last_verified TIMESTAMPTZ DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(video_url)
);
CREATE INDEX idx_hooks_niche_score ON hooks(niche_id, outlier_score DESC);

CREATE TABLE swipe_file (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hook_id    INTEGER NOT NULL REFERENCES hooks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, hook_id)
);

CREATE TABLE script_packs (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  niche_id   INTEGER REFERENCES niches(id) ON DELETE SET NULL,
  title      VARCHAR(200) DEFAULT '',
  scripts    JSONB NOT NULL,   -- [{hookId, hookTemplate, sourceStats, kind:'educational'|'story', notes, bullets[], caption}]
  sample     BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_script_packs_user ON script_packs(user_id, created_at DESC);

CREATE TABLE carousels (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hook_id     INTEGER REFERENCES hooks(id) ON DELETE SET NULL,
  style       VARCHAR(50) DEFAULT 'bold',
  slides      JSONB NOT NULL,  -- [{index, heading, body, imagePrompt}]
  caption     TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_carousels_user ON carousels(user_id, created_at DESC);

-- Structured business profile + new gating counters
ALTER TABLE users ADD COLUMN profile JSONB;                     -- {sells, audience, results[], tone, niche_slug, source_url}
ALTER TABLE users ADD COLUMN packs_used INTEGER DEFAULT 0;      -- monthly, reset with usage_reset_at
ALTER TABLE users ADD COLUMN carousels_used INTEGER DEFAULT 0;  -- monthly
ALTER TABLE users ADD COLUMN sample_pack_used BOOLEAN DEFAULT FALSE;
