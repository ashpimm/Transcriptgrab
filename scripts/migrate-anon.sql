-- migrate-anon.sql — taste-first anonymous generation.
-- The app also creates these lazily (ensureAnonSchema in api/_db.js) the first
-- time an anon request runs, so this script is optional; run it to provision
-- the schema ahead of enabling ANON_IP_SALT.
--   node scripts/run-migration.mjs scripts/migrate-anon.sql

CREATE TABLE IF NOT EXISTS anon_slots (
  id SERIAL PRIMARY KEY,
  anon_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved',   -- reserved | complete | released
  profile JSONB,
  carousel_id INT,
  claimed_by INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS anon_slots_ip ON anon_slots (ip_hash);
CREATE INDEX IF NOT EXISTS anon_slots_anon ON anon_slots (anon_id);

-- Anon carousels own a row with a NULL user_id until claimed at signup.
ALTER TABLE carousels ADD COLUMN IF NOT EXISTS anon_id TEXT;
ALTER TABLE carousels ALTER COLUMN user_id DROP NOT NULL;
