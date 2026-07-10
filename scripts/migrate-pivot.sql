-- VIBECODER PIVOT MIGRATION (run after migrate-hooklab.sql)
-- Run once in the Neon console.

-- Free tier: one watermarked carousel, ever.
ALTER TABLE users ADD COLUMN IF NOT EXISTS free_carousel_used BOOLEAN DEFAULT FALSE;

-- Whether a carousel was generated on the free tier (watermark on last slide).
ALTER TABLE carousels ADD COLUMN IF NOT EXISTS watermark BOOLEAN DEFAULT FALSE;

-- users.credits is repurposed: was TranscriptGrab video credits, now carousel
-- credits ($5 = 8). Zero out legacy balances so nobody inherits free carousels.
UPDATE users SET credits = 0;

-- users.profile is reshaped in-app to {app_url, name, what, who, benefit, tone}.
-- Old {sells, audience, results, tone, niche_slug} profiles are incompatible.
UPDATE users SET profile = NULL;
