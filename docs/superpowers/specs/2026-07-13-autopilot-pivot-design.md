# Autopilot Pivot — Design Spec (2026-07-13)

Supersedes `2026-07-10-vibecoder-pivot-design.md` where they conflict. That spec's
architecture (pages, auth, Stripe plumbing, hybrid slide render) stays; this spec
changes what the product does with it.

## One sentence

Paste your app's URL → AI builds daily slideshow/carousel content in **your users'**
niche → auto-posts to your TikTok + Instagram every day. A faceless marketing
employee for $19/mo.

## Why (what was wrong)

The current product generates content in the `appdev` niche for every app.
`appdev` content (build-in-public, cal.ai founder stories) speaks to indie hackers —
the app **builder's** peers, not the app's **buyers**. A calorie-counter app's buyers
are fitness/weight-loss people; content that sells it must live in that niche.
`api/carousel.js` hardcodes `getAutoHookPool('appdev', 10)` — the mismatch is baked in.

Second problem: generated slideshows read as a random hook statement followed by
marketing copy. No narrative arc, no real value, nothing a human would post.

Third problem: no distribution. Users get a ZIP. The proven competitor (ReelFarm,
$10k MRR solo dev at $19/mo) sells **automation**: content created AND posted daily
without the user touching it. Arcads proves the ceiling ($15M ARR, bootstrapped).

## Product decisions (locked)

- Slideshows/carousels only. No AI avatar/UGC video until there are paying users (phase 2).
- Auto-posting via upload-post.com aggregator API (no TikTok/Meta app audits).
  $16/mo for 5 connected customer profiles; NOT enabled until first paying customer.
- Pricing: Free = 3 carousels ever, watermarked, manual export. Autopilot = $19/mo,
  daily auto-post to TikTok + Instagram, no watermark. $5 credit packs killed
  (legacy credits still honored in consumption order until zero).
- Dogfood: the owner's calorie-counter app is account zero; its growth becomes the
  landing-page receipts.
- Unit economics: ~$5-5.50/user/mo at first (gen ~$1.50, upload-post share ~$3.20,
  Stripe ~$0.85), dropping toward ~$3 at scale. $19 price holds ~70%+ margin.
  Optional launch coupon (first 20 users, $12/mo forever) instead of repricing.

## 1. Audience-niche engine

**Goal:** every app generates content in its buyers' niche, not `appdev`.

- Profile: `APP_PROFILE_PROMPT` additionally derives `audience_niche`
  ({slug, name, keywords[]}) from the app's what/who/benefit. Stored in
  `users.profile.audience_niche`. Shown on the profile card, user-editable
  (confirm step already exists).
- Niches table becomes dynamic: when a derived niche has no row, insert one
  (slug, name, Gemini-generated keywords). Seeded niches (fitness, realtors,
  coaches, appdev) remain as warm starts.
- Miner: unchanged pipeline (YouTube search → 5x outlier rule → isMostlyLatin
  gates → Gemini relevance gate), but `getStalestNiche` boosts niches that have
  active subscribers instead of hardcoding `appdev`. New niche rows get mined
  on first demand (synchronous kick from profile save if hook pool < N, else cron).
- Hook pool: `getAutoHookPool(profile.audience_niche.slug, 10)` — `appdev` is just
  another niche, used only when the app's buyers are developers.
- Cold-niche fallback: if a fresh niche has zero mined hooks at generation time,
  Gemini adapts the curated cross-niche hook patterns (the seeded curated rows are
  format patterns, portable across niches) and mining backfills via cron.

## 2. Content engine — narrative arc

**Goal:** slideshow reads as one coherent piece a human would post, not
hook + filler + ad.

- One Gemini planning call produces the whole slideshow as a single narrative:
  - Mined hook is a **pattern to adapt**, never pasted verbatim.
    "5 things I wish I knew before ___" → "5 things I wish I knew before trying
    to lose weight".
  - Slide 1 makes a promise; slides 2–N pay off exactly that promise with real,
    specific, useful content (numbered tips, mistakes, mini-plan — listicle value).
  - Final slide ties back to the arc: the last point naturally involves the app's
    job-to-be-done, then names the app + "link in bio". Payoff, not pivot.
  - Hard prompt rule: the reader must never feel the topic change between slide 1
    and the last slide.
  - Self-check pass: same call (or cheap follow-up) judges the draft — "does the
    last slide follow from slide 1's promise? is every middle slide substantive?" —
    and revises once before returning.
- Content mix rotation per user: ~75% value listicles in the audience niche,
  ~25% direct app showcase (uses profile screenshots/motifs; still narrative:
  problem → how the app solves it).
- Render: keep hybrid pipeline (one textless AI background per slideshow +
  client/canvas text, SLIDE_THEMES, brand color pipeline). Two changes:
  - **No slide-number chips.** Remove the index chip from canvas render entirely.
  - **Subtle watermark** (free tier only): small, low-opacity (~35%), muted color,
    bottom corner of last slide only. Never the brand orange, never a badge/pill.
- Caption + hashtags: generated with the plan, niche-targeted (already exists,
  retargeted to audience niche).

## 3. Calendar + auto-posting

- New table `posts`: id, user_id, scheduled_at, status
  (queued | rendered | posted | failed | skipped), slides JSONB (text plan +
  background ref), caption, hashtags, platforms[], external_post_ids JSONB,
  error TEXT, created_at.
- Server-side render: auto-posting requires final PNGs without a browser.
  Reuse the canvas text-drawing logic via `@napi-rs/canvas` (or equivalent) in a
  serverless fn — same SLIDE_THEMES constants, shared module so client preview and
  server render can't drift.
- Daily cron (extends existing vercel.json cron): for each active Autopilot
  subscriber — top up queue to 3 days ahead (generate plans + backgrounds), render
  due posts, publish via upload-post API, record status. Failures retry next run
  once, then mark failed + surface in dashboard.
- Connect flow: user links TikTok/Instagram once via upload-post's hosted linking
  page (JWT flow). One upload-post "profile" per customer.
- No-connection fallback and Free tier: manual export ZIP (already built) +
  dashboard "ready to post" queue.
- Feature flag `UPLOAD_POST_API_KEY` unset → whole product runs in manual mode
  (dogfood period costs $0).

## 4. Pricing + gating changes

- Free: 3 carousels ever (was 1), watermark, manual export only.
- Autopilot $19/mo: new Stripe price (STRIPE_AUTOPILOT_PRICE_ID), replaces $9 Pro.
  Existing $9 subscribers (if any) grandfathered.
- `canGenerateCarousel` consumption order: autopilot (unmetered within fair-use
  30 posts/mo) → legacy credits → free-3.
- Landing page: repositioned around autopilot ("your app's faceless TikTok +
  Instagram, on autopilot"), pricing section Free/$19 two-column, receipts strip
  fed by dogfood account once real.

## 5. Out of scope (explicit)

- AI avatar / UGC video generation (phase 2, gated on paying users).
- Analytics ingestion (views/followers sync from platforms).
- YouTube Shorts / other platforms (upload-post supports them; enable later).
- Name/domain change (still parked).
- Feed page redesign (stays as public mined-hooks browser; SEO surface).

## Migration notes

- `users.profile` gains `audience_niche`; existing profiles get it derived on next
  profile save (same lazy pattern as brand color backfill).
- `posts` table is new; no changes to `carousels` (kept for one-off generations).
- vercel.json: existing daily miner cron stays; add posts cron (or fold both into
  one endpoint that mines then posts — one cron slot on hobby plan).

## Success criteria

1. Calorie-counter profile generates fitness/weight-loss content — zero appdev bleed.
2. A generated slideshow reads as one arc: promise → payoff → natural CTA.
3. With upload-post key set + account linked, a queued post lands on TikTok +
   Instagram with no manual step.
4. Free user hits watermark + 3-cap; upgrade → next cron includes them.
5. Slides have no index chips; free watermark is subtle (low-opacity, corner).
