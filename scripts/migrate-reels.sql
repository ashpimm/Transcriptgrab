-- Durable, asynchronous download-only Reel rendering state.
ALTER TABLE carousels ADD COLUMN IF NOT EXISTS reel_status VARCHAR(20);
ALTER TABLE carousels ADD COLUMN IF NOT EXISTS reel_render_id VARCHAR(100);
ALTER TABLE carousels ADD COLUMN IF NOT EXISTS reel_url TEXT;
ALTER TABLE carousels ADD COLUMN IF NOT EXISTS reel_poster_url TEXT;
ALTER TABLE carousels ADD COLUMN IF NOT EXISTS reel_error TEXT;
ALTER TABLE carousels ADD COLUMN IF NOT EXISTS reel_requested_at TIMESTAMPTZ;
ALTER TABLE carousels ADD COLUMN IF NOT EXISTS reel_checked_at TIMESTAMPTZ;
ALTER TABLE carousels ADD COLUMN IF NOT EXISTS reel_finished_at TIMESTAMPTZ;
ALTER TABLE carousels ADD COLUMN IF NOT EXISTS reel_url_expires_at TIMESTAMPTZ;
