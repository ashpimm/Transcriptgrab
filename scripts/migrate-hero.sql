-- scripts/migrate-hero.sql — Photographic hook slide (2026-07-13 spec)
-- Run AFTER migrate-autopilot.sql (this touches the posts table it creates).
-- Run with: node scripts/run-migration.mjs scripts/migrate-hero.sql

-- The hook slide's photograph (base64 PNG), cached like bg so history is free.
ALTER TABLE carousels ADD COLUMN IF NOT EXISTS hero TEXT;

-- The model-written scene the photograph depicts. Persisted so a history view
-- or an autopilot re-render shoots the SAME scene instead of inventing one.
-- Empty on carousels made before this shipped: those keep the abstract bg.
ALTER TABLE carousels ADD COLUMN IF NOT EXISTS hero_scene TEXT DEFAULT '';
ALTER TABLE posts     ADD COLUMN IF NOT EXISTS hero_scene TEXT DEFAULT '';
