# Hooklab launch smoke checklist

Run on a Vercel preview deploy after: (1) migration + seeds applied in Neon, (2) env vars set.

## One-time setup (blocking)
- [ ] Run `scripts/migrate-hooklab.sql` in Neon console (or `node scripts/run-migration.mjs scripts/migrate-hooklab.sql` with POSTGRES_URL)
- [ ] Run `scripts/seed-niches.sql` the same way
- [ ] Vercel env: `YOUTUBE_API_KEY` (Google Cloud → YouTube Data API v3)
- [ ] Vercel env: `ADMIN_SECRET` (any long random string)
- [ ] Stripe: create $39/mo price, update `STRIPE_PRO_PRICE_ID`
- [ ] `STRIPE_SINGLE_PRICE_ID` no longer used — can be removed

## Miner
- [ ] `GET /api/mine?secret=...&niche=appdev&dry=1` returns candidates
- [ ] Real run per niche inserts hooks; `/api/hooks?niche=appdev` shows them
- [ ] Cron visible in Vercel project settings (daily 06:00 UTC)

## Anonymous
- [ ] Landing loads; hero feed animates (live data once mined, fallback before)
- [ ] Library shows 8-hook teaser + sign-in strip
- [ ] Save button on a card redirects to Google sign-in

## Free account
- [ ] Sign-in lands on /library; top 20 per niche visible
- [ ] Save 25 hooks; 26th shows upgrade modal (variant: library)
- [ ] /profile manual save works; import button shows Pro modal
- [ ] Studio: 3-script sample generates once; second attempt shows packs modal
- [ ] 10/20 pack sizes gated behind Pro modal
- [ ] Carousel plan gated behind Pro modal

## Pro (test-mode subscription)
- [ ] /api/checkout?plan=pro → Stripe checkout → webhook flips tier to pro
- [ ] Full library depth, unlimited swipe saves
- [ ] Profile import from a real Play Store URL prefills fields
- [ ] 10-pack generates; regen replaces one script; receipts line shows real stats
- [ ] Carousel: plan + 6 slides render + per-slide redo + download all
- [ ] Caps enforced: 11th pack and 31st carousel blocked with reset message
- [ ] Billing portal opens from nav dropdown; cancel downgrades (webhook)

## Sweep
- [ ] No "TranscriptGrab" string anywhere user-visible
- [ ] No dead links (old /app, /workspace, /dashboard routes gone)
- [ ] Browser console clean (no CSP violations)
- [ ] Mobile: hero, library grid, studio stack correctly
