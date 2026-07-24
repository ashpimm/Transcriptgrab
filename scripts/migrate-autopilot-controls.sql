-- Autopilot user controls (2026-07-25): on/off toggle + posting-time slot.
-- Idempotent; ensureAutopilotReliabilitySchema also bootstraps these on the
-- first worker/social run after deploy, this script is the source of truth.

ALTER TABLE users ADD COLUMN IF NOT EXISTS autopilot_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS post_slot TEXT NOT NULL DEFAULT '20:30';
