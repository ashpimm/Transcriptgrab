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
