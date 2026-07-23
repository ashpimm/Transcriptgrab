# Taste-First Anonymous Generation — HANDOFF (2026-07-24)

Built overnight while you slept. **All local, committed to `main`, NOT pushed** —
nothing is live until you push via GitHub Desktop. And even after you push, the
whole feature stays dormant until you set one secret (`ANON_IP_SALT`). So pushing
is safe: prod behaves exactly as today until you flip that switch.

## What it does

A logged-out visitor pastes their product link, gets a full real post (6 slides +
AI cover photo + caption + hashtags) for their own app **with no account**, then
signs in only to download/keep it. On sign-in, that exact post + its product
profile are already in their account (counted as free post #1).

Guards: **1 completed post per IP, ever** + **75 completed posts/day** global
(botnet ceiling). Anon posts are always watermarked. Failures release the slot so
our errors never burn a visitor's one taste.

## Commits (7)

1. spec · 2. plan · 3. `_anon.js` helpers · 4. `anon_slots` DB layer ·
5. session-or-anon `/api/profile` + `/api/carousel` · 6. claim-on-signup in OAuth
callback · 7. frontend (drop wall, gate at download, output-first).

Tests: **183/183 green** (`node --test tests/*.test.mjs`), incl. 31 new anon tests.

## TO GO LIVE — do these, in order

1. **Push** `main` via GitHub Desktop (deploys to Vercel; still dormant).
2. **Provision the schema** (optional — the app also self-migrates on first anon
   hit): `node scripts/run-migration.mjs scripts/migrate-anon.sql`
3. **Generate the secret yourself** (never let me): a long random string, e.g. in
   your terminal `openssl rand -hex 32`. Put it in your password manager.
4. **Set Vercel env vars** (Project → Settings → Environment Variables):
   - `ANON_IP_SALT` = the random string from step 3  **(this is the on-switch)**
   - `ANON_DAILY_CAP` = `75`  (optional; omit and it defaults to 75)
   - Redeploy so the env takes effect.

## UNVERIFIED — what I could NOT test locally

I have no prod DB, no live Gemini/image keys, and can't run the Google OAuth
round-trip headless. So these are code-complete + unit-tested, but need one real
run-through:

- **The end-to-end anon generation** (import → save → plan → cover photo render).
- **claim-on-signup** actually moving the carousel + profile onto the new user.
- **The throttle** refusing a 2nd attempt from the same IP / at the daily cap.
- **The migration** applying cleanly on the real `carousels` table.

## Morning smoke test (5 min, once enabled)

1. Open an **incognito** window (logged out) → go to the site → paste a product
   link in the hero → it should land on `/create` and auto-generate a full post
   **without asking you to sign in**. Watch the cover photo + 6 slides render.
2. The download button should read **"Sign in free to download & keep."** Click it
   → sign in with Google → you should land on `/create` with **that same post in
   "Recent posts"** and it should count as 1 of your 3 free posts.
3. Back in a **fresh incognito** (same IP), try again → after one completed post
   the studio should refuse the 2nd and show the sign-in gate/CTA. (If your IP
   already completed one in step 1, you'll see this immediately — that's correct.)
4. Sanity: a **logged-in** normal generate + download still works unchanged.

If step 1 shows the old sign-in gate instead of generating, `ANON_IP_SALT` isn't
set/deployed yet.

## Notes / decisions

- Anon `x-real-ip` is hashed with the salt; raw IPs are never stored.
- Reel export stays Pro-only; anon can't reach it.
- Create page: once a post exists, the pre-sell chrome (illustrative deck,
  deliverables grid, proof chip, "what we'll do" hints, customize panel) hides so
  the page stops explaining what you can already see. This is the pragmatic
  output-first pass. A deeper *visual* redesign of the create studio (with the
  frontend-design skill) is a good follow-up if you want it — I kept the layout
  intact to avoid breaking the working studio unattended.
- Follow-ups parked in memory: dogfood self-marketing (`self-marketing-engine`),
  recent-posts slide view (`recent-posts-view`).

## Rollback

If anything misbehaves: unset `ANON_IP_SALT` in Vercel + redeploy → feature goes
fully dormant, zero effect on logged-in/paid flows. The `anon_slots` table and the
`carousels.anon_id` column are harmless to leave in place.
