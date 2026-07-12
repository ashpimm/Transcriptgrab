# Hooklab Autopilot smoke checklist

"You built the app. This makes it seen." — paste app URL, Gemini derives your
*audience's* content niche (not app-dev), a daily cron drafts narrative
slideshows and posts them to TikTok + Instagram via upload-post.com. Free =
3 carousels ever, watermarked, manual export. Autopilot ($19/mo) = 30/mo,
no watermark, auto-scheduled + auto-posted.

Run this on a Vercel preview deploy after the USER ACTIONS below are done
(or as much of it as applies — Autopilot's auto-post leg is inert until
`UPLOAD_POST_API_KEY` is set, everything else works without it).

## USER ACTIONS (blocking — Claude cannot do these)

- [ ] **Run the migration.** `scripts/migrate-autopilot.sql` was written in
      Task 1 but never applied (no local `POSTGRES_URL`). Run:
      `node scripts/run-migration.mjs scripts/migrate-autopilot.sql`
      (needs `POSTGRES_URL` env pointed at the Neon prod DB). Adds
      `users.free_carousels_used` (migrates old `free_carousel_used` boolean),
      `users.upload_post_username`, and the `posts` table + indexes.
      Safe to re-run (`IF NOT EXISTS` throughout).
- [ ] **Create the $19/mo Stripe price** and set `STRIPE_AUTOPILOT_PRICE_ID`
      in Vercel env. Until set, `?plan=autopilot` checkout falls back to
      `STRIPE_PRO_PRICE_ID` (see `api/checkout.js` line ~19) — so checkout
      won't break, but it'll charge the wrong amount/price object.
- [ ] **Sign up at upload-post.com** and set `UPLOAD_POST_API_KEY` in Vercel
      env once the first customer actually pays for Autopilot. Until then
      `uploadPostEnabled()` is false everywhere: `/api/social` link action
      returns 503 ("Auto-posting is not enabled yet — download and post
      manually for now"), and the autopilot cron's Phase 2 (publish) is
      skipped entirely — Phase 1 (queue top-up) still runs and fills the
      `posts` table, it just never ships anything.
- [ ] **Push `hooklab-rebuild` to `main` via GitHub Desktop** (CLI push fails
      on the `/dev/tty` credential prompt in this environment) — then let
      Vercel deploy prod.
- [ ] **After prod deploy, run the four checks in "Post-deploy prod smoke"
      below** — several things here are code-complete but never verified
      against a live Vercel deployment.

## Miner (unchanged from pre-autopilot)
- [ ] `GET /api/mine?secret=$ADMIN_SECRET&niche=appdev&dry=1` returns candidates
- [ ] Real run per niche inserts hooks; `/api/hooks?niche=appdev` shows them
- [ ] Cron visible in Vercel project settings — `/api/mine` daily 06:00 UTC

## Audience-niche derivation (Task 2)
- [ ] Import an app whose *users* are not developers — e.g. a calorie/weight-
      loss tracker — via `/create` profile import. `audience_niche.name`
      should come back something like "Fitness & Weight Loss", **not**
      "App Development" / "Indie Hackers". (Prompt is deliberately steered
      away from the app-*builder's* niche toward the app's *users'* niche —
      see `AUDIENCE_NICHE_PROMPT` in `api/_prompts.js`.)
- [ ] Import a genuine dev-tool app (e.g. a CLI or API product) — niche should
      correctly land on App Development/Indie Hackers this time.
- [ ] Saved profile with a fresh `audience_niche` best-effort pre-warms a hook
      pool (`getAutoHookPool` in `api/profile.js`) if `YOUTUBE_API_KEY` is set;
      absence of the key must not block the profile save (best-effort, caught).

## Narrative generation (Tasks 4-6)
- [ ] Generate a carousel from `/create`. Read the slides top to bottom —
      they should read as **one throughline** (a mini-story/listicle), not
      six disconnected captioned images.
- [ ] Roughly 3-in-4 generations should be "value" content (niche tips/listicle)
      and 1-in-4 "showcase" (direct app pitch) — `postKind(n)` in
      `api/_generate.js` is deterministic by post count, not random, so this
      is easiest to eyeball over several autopilot-queued posts rather than
      one-off manual generations.
- [ ] Slides render via the shared `slide-render.mjs` renderer both client-side
      (create page canvas) and server-side (autopilot cron) — spot check that
      a client-generated carousel and a server-rendered one (see below) look
      visually consistent (same font, accent bar, index chip placement).

## Free tier gating (3 ever, not 1/month)
- [ ] Fresh free account: generate 3 carousels total. Each has the
      watermark ("made with Hooklab") on the last slide.
- [ ] 4th attempt is blocked with an upgrade prompt — `canGenerateCarousel`
      checks `free_carousels_used < 3` (`FREE_CAROUSELS` in `api/_db.js`).
- [ ] A legacy account with the old `free_carousel_used = TRUE` boolean (no
      migration run yet) should read as "1 of 3 used", not "0 of 3" or
      blocked outright — this is exactly what the migration's boolean→int
      backfill (`free_carousels_used = 1 WHERE free_carousel_used = TRUE`)
      is for. Confirm post-migration.

## Autopilot ($19/mo) — `/api/social` + `/api/autopilot`
- [ ] Pricing section shows $19/mo "Go Autopilot" CTA → `/api/checkout?plan=autopilot`.
- [ ] Stripe checkout (test mode) completes → webhook flips `tier` to `pro`
      (autopilot reuses the existing pro tier/webhook path, just a different
      price id and messaging).
- [ ] On `/account`, with `UPLOAD_POST_API_KEY` **unset**: social section
      shows "not enabled yet" state, no crash. `GET /api/social` returns
      `{ enabled: false, connected: false, ... }`.
- [ ] With `UPLOAD_POST_API_KEY` **set**: "Connect TikTok/Instagram" triggers
      `POST /api/social {action:'link'}` → returns a hosted upload-post link
      URL; after linking, `connected: true` and `username` populate.
- [ ] `GET /api/autopilot?secret=$ADMIN_SECRET` (dry, no cron header) returns
      `{ toppedUp, posted, failed, errors }` JSON, 200. With no Autopilot
      subscribers yet, expect `{ toppedUp: 0, posted: 0, failed: 0, errors: [] }`.
- [ ] With at least one Autopilot subscriber with a complete profile: Phase 1
      queues up to 3 days of posts (75/25 value/showcase mix), respecting
      the 30/mo cap (`consumeCarousel(user, 'pro')` per queued post).
- [ ] With `UPLOAD_POST_API_KEY` set and a due post: Phase 2 renders PNGs
      server-side (`renderSlidePngs`, no watermark — autopilot is always
      paid) and calls `uploadPhotos` for `['tiktok', 'instagram']`; on
      failure, one retry (`retries < 1` → requeue), then `failed`.
- [ ] Cron visible in Vercel project settings — `/api/autopilot` daily 14:30 UTC.

## Pricing page
- [ ] Free / $19 Autopilot / $5 credits tiers all present and copy matches
      current gating (3 free ever, 30/mo autopilot, no monthly credit expiry).
- [ ] No leftover "$39/mo Pro" or "1 free carousel" copy from the previous
      pivot.

## Post-deploy prod smoke (do after the "push main" user action above)
- [ ] `GET https://transcriptgrab.vercel.app/slide-render.mjs` serves with a
      JS content-type (`application/javascript` or similar) — module MIME
      handling for a bare `.mjs` static file under Vercel is untested;
      if it serves as `text/plain` or 404s, the client-side create-page
      import will break even though local dev works fine.
- [ ] `GET /api/autopilot?secret=$ADMIN_SECRET` on prod returns 200 JSON
      (not 401 — confirms `ADMIN_SECRET` is set in Vercel env and matches).
- [ ] `GET /api/mine?secret=$ADMIN_SECRET&dry=1` on prod still 200s (regression
      check — same secret gate pattern, cheap to verify while there).
- [ ] Re-save a profile on prod (any existing account) to backfill
      `audience_niche` for accounts created before Task 2 shipped — old
      profiles have `audience_niche: null` until their owner re-saves.
- [ ] Vercel Functions tab: confirm both crons (`/api/mine`, `/api/autopilot`)
      show as scheduled and `api/autopilot.js`'s `includeFiles` actually
      traced in `fonts/**` + `slide-render.mjs` (Task 8 concern — check a
      cold-start invocation doesn't 500 on a missing font file).

## Sweep
- [ ] No "TranscriptGrab" or "script pack" string anywhere user-visible
      (both are dead concepts from earlier pivots)
- [ ] No dead links (old `/library`, `/studio`, `/profile` still 301-redirect
      correctly per `vercel.json`)
- [ ] Browser console clean (no CSP violations) — note CSP is `script-src
      'self' 'unsafe-inline'` with no CDN allowance, so any new third-party
      script tag will silently fail
- [ ] Mobile: hero, pricing cards, create-page slide preview stack correctly
