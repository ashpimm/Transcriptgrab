-- TranscriptGrab Database Schema
-- Run this in the Neon/Vercel Postgres console to set up the database.

CREATE TABLE users (
  id              SERIAL PRIMARY KEY,
  google_id       VARCHAR(255) UNIQUE NOT NULL,
  email           VARCHAR(255) NOT NULL,
  name            VARCHAR(255) DEFAULT '',
  picture         VARCHAR(512) DEFAULT '',
  tier            VARCHAR(20) DEFAULT 'free',
  stripe_customer_id     VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  credits         INTEGER DEFAULT 0,
  monthly_usage   INTEGER DEFAULT 0,
  usage_reset_at  TIMESTAMPTZ DEFAULT (date_trunc('month', NOW()) + INTERVAL '1 month'),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sessions (
  id          VARCHAR(64) PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_stripe_customer_id ON users(stripe_customer_id);
CREATE INDEX idx_users_stripe_subscription_id ON users(stripe_subscription_id);

CREATE TABLE single_credits (
  token VARCHAR(64) PRIMARY KEY,
  stripe_session_id VARCHAR(255) UNIQUE NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- PROCESSED CHECKOUTS (payment idempotency)
-- ============================================
CREATE TABLE processed_checkouts (
  stripe_session_id VARCHAR(255) PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- GENERATIONS (content workspace)
-- ============================================
CREATE TABLE generations (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id      VARCHAR(11) NOT NULL,
  video_title   VARCHAR(500) DEFAULT '',
  video_thumb   VARCHAR(512) DEFAULT '',
  platforms     VARCHAR(100)[] DEFAULT '{}',
  content       JSONB NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, video_id)
);
CREATE INDEX idx_generations_user_id ON generations(user_id);
CREATE INDEX idx_generations_user_created ON generations(user_id, created_at DESC);

-- ============================================
-- LINKED CHANNELS (auto-generate from channel)
-- ============================================
CREATE TABLE linked_channels (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_url     VARCHAR(512) NOT NULL,
  channel_name    VARCHAR(255) DEFAULT '',
  default_formats VARCHAR(100)[] DEFAULT '{twitter,linkedin}',
  known_video_ids TEXT[] DEFAULT '{}',
  enabled         BOOLEAN DEFAULT TRUE,
  last_checked_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);
CREATE INDEX idx_linked_channels_enabled ON linked_channels(enabled);

ALTER TABLE generations ADD COLUMN auto_generated BOOLEAN DEFAULT FALSE;

-- ============================================
-- SOCIAL CONNECTIONS (future: auto-posting)
-- ============================================
CREATE TABLE social_connections (
  id                 SERIAL PRIMARY KEY,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform           VARCHAR(30) NOT NULL,
  platform_user_id   VARCHAR(255),
  platform_username  VARCHAR(255),
  access_token       TEXT,
  refresh_token      TEXT,
  token_expires_at   TIMESTAMPTZ,
  connected_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, platform)
);

CREATE TABLE post_status (
  id                   SERIAL PRIMARY KEY,
  generation_id        INTEGER NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
  platform             VARCHAR(30) NOT NULL,
  variation_index      INTEGER DEFAULT 0,
  status               VARCHAR(20) DEFAULT 'draft',
  social_connection_id INTEGER REFERENCES social_connections(id) ON DELETE SET NULL,
  posted_at            TIMESTAMPTZ,
  external_post_id     VARCHAR(255),
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(generation_id, platform, variation_index)
);

-- ============================================
-- ANONYMOUS FREE GENERATION TRACKING
-- ============================================
CREATE TABLE free_generations (
  ip_hash     VARCHAR(64) PRIMARY KEY,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- MIGRATION: Multi-platform video support
-- ============================================
-- Widen video_id to store full URLs for non-YouTube platforms
ALTER TABLE generations ALTER COLUMN video_id TYPE VARCHAR(512);
-- Add platform column to track video source
ALTER TABLE generations ADD COLUMN platform VARCHAR(20) DEFAULT 'youtube';
