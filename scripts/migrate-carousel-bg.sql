-- Cache the generated background image on the carousel so history views
-- reuse it instead of buying a new Gemini image per click.
ALTER TABLE carousels ADD COLUMN IF NOT EXISTS bg TEXT;
