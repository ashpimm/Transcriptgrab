# Hooklab Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild TranscriptGrab into Hooklab — a library-first short-form content agency-in-a-box (outlier hook research → script packs → AI faceless carousels), per `docs/superpowers/specs/2026-07-03-hooklab-rebuild-design.md`.

**Architecture:** Vanilla HTML/CSS/JS frontend + Vercel serverless functions (Node ESM) + Neon Postgres. Hook library fed by a YouTube Data API miner (5x rule scoring) cached per niche; Gemini 2.5 Flash for text generation; `gemini-2.5-flash-image` for carousel slides. Export-first (no social posting in v1).

**Tech Stack:** Vercel Hobby, `@neondatabase/serverless`, Stripe, Gemini API (existing `callGemini` in `api/_shared.js`), YouTube Data API v3, Google OAuth (existing).

## Global Constraints

- **Max 12 Vercel serverless functions.** Target budget: 10 (`auth/google`, `auth/callback`, `auth/me`, `checkout`, `webhook`, `hooks`, `profile`, `generate`, `carousel`, `mine`). `_`-prefixed files in `api/` are NOT functions.
- **No build system.** Plain HTML/CSS/JS files at repo root. No npm frontend deps, no bundler.
- **CSP:** `script-src 'self' 'unsafe-inline'` — no external JS. Fonts from Google Fonts allowed. Add `https://generativelanguage.googleapis.com` is NOT needed client-side (all AI calls server-side).
- **Session cookie stays `tg_session`** (cosmetic rename not worth breaking sessions).
- **Vercel Hobby limits:** function timeout — keep every endpoint < 10s design budget (carousel = one slide per request); cron allowed once daily.
- **Brand:** Hooklab everywhere. No "TranscriptGrab", no "PostMaxx".
- **New env vars:** `YOUTUBE_API_KEY` (required for miner), `ADMIN_SECRET` (manual mine trigger), `APIFY_TOKEN` (optional, v1.1 TikTok). User must create these in Vercel.
- **Copy style (from spec):** scripts must ban AI-tells: "here's the truth", "skyrocket", "game-changer", em-dashes.
- **Frontend visual work:** invoke `frontend-design` skill at execution time; direction = modern, intricate, animated landing; owner delegated taste.

---

## Phase 0 — Teardown & Rebrand

### Task 1: Delete dead code, demote transcript endpoint

**Files:**
- Delete: `api/social.js`, `api/social-callback.js`, `api/schedule.js`, `api/library.js`
- Delete: `library.html`, `dashboard.html`, `workspace.html`, `transcripts.html`, `analyze.html`, `create.html`, `search.html`, `app.html`, `content-cards.js`, `content-cards.css`
- Rename: `api/transcript.js` → `api/_transcript.js` (internal helper for miner; strip the HTTP handler, export `fetchTranscript(videoUrl)` returning `{ text }` via Supadata — keep the existing Supadata fetch logic, delete req/res plumbing)
- Modify: `vercel.json` (remove deleted rewrites/redirects; keep auth/checkout/webhook/privacy/terms; root `/` serves `index.html` automatically)

**Interfaces:**
- Produces: `api/_transcript.js` exporting `async function fetchTranscript(videoUrl) -> { text: string }` (throws on failure) — consumed by Task 5 miner.

**Steps:**
- [ ] Delete files listed above (`git rm`)
- [ ] Rewrite `api/transcript.js` content into `api/_transcript.js` as pure helper (no `handleCors`, no `export default`)
- [ ] Update `vercel.json`: remove rewrites for `/api/transcript`, `/api/library`, `/api/social`, `/api/social-callback`, `/api/schedule`, `/app`, `/workspace`, `/library`, `/dashboard`; remove all `redirects` entries pointing at `/app`
- [ ] Verify: `node --check api/_transcript.js` passes; grep repo for references to deleted files (`content-cards`, `workspace`, `api/social`, `api/schedule`, `api/library`) in remaining files — clean up hits in `nav.js`, `pro.js`, `index.html`
- [ ] Commit: `refactor: tear out social/schedule/workspace and transcript endpoint for Hooklab rebuild`

### Task 2: Rebrand sweep

**Files:**
- Modify: `nav.js`, `pro.js`, `index.html`, `privacy.html`, `terms.html`, `package.json`, `api/_shared.js` (comments), any remaining `TranscriptGrab` strings

**Steps:**
- [ ] `grep -ri "transcriptgrab\|transcript grab\|postmaxx"` across repo (excluding node_modules) — replace with `Hooklab`
- [ ] `package.json` name → `hooklab`
- [ ] localStorage keys: keep `tg_` prefixes (data continuity irrelevant with 0 users, but renaming invites bugs — leave)
- [ ] Commit: `chore: rebrand to Hooklab`

---

## Phase 1 — Data Layer

### Task 3: New tables + DB helpers

**Files:**
- Modify: `schema.sql` (append migration block), `api/_db.js` (add helpers)
- Create: `scripts/migrate-hooklab.sql` (just the new-tables block, for pasting into Neon console)

**Migration SQL (exact):**

```sql
-- HOOKLAB MIGRATION
CREATE TABLE niches (
  id          SERIAL PRIMARY KEY,
  slug        VARCHAR(50) UNIQUE NOT NULL,
  name        VARCHAR(100) NOT NULL,
  keywords    TEXT[] NOT NULL DEFAULT '{}',
  seed_channels TEXT[] NOT NULL DEFAULT '{}',
  active      BOOLEAN DEFAULT TRUE,
  last_mined_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE hooks (
  id            SERIAL PRIMARY KEY,
  niche_id      INTEGER NOT NULL REFERENCES niches(id) ON DELETE CASCADE,
  hook_template TEXT NOT NULL,
  hook_verbatim TEXT DEFAULT '',
  topic         VARCHAR(300) DEFAULT '',
  format        VARCHAR(30) DEFAULT 'talking_head',  -- talking_head|whiteboard|audio_broll|skit|other
  platform      VARCHAR(20) DEFAULT 'youtube',
  video_url     VARCHAR(512) NOT NULL,
  video_title   VARCHAR(500) DEFAULT '',
  views         BIGINT DEFAULT 0,
  followers     BIGINT DEFAULT 0,
  outlier_score NUMERIC(8,2) DEFAULT 0,             -- views / followers
  curated       BOOLEAN DEFAULT FALSE,
  last_verified TIMESTAMPTZ DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(video_url)
);
CREATE INDEX idx_hooks_niche_score ON hooks(niche_id, outlier_score DESC);

CREATE TABLE swipe_file (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hook_id    INTEGER NOT NULL REFERENCES hooks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, hook_id)
);

CREATE TABLE script_packs (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  niche_id   INTEGER REFERENCES niches(id) ON DELETE SET NULL,
  title      VARCHAR(200) DEFAULT '',
  scripts    JSONB NOT NULL,   -- [{hookId, hookTemplate, sourceStats, kind:'educational'|'story', notes, bullets[], caption}]
  sample     BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_script_packs_user ON script_packs(user_id, created_at DESC);

CREATE TABLE carousels (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hook_id     INTEGER REFERENCES hooks(id) ON DELETE SET NULL,
  style       VARCHAR(50) DEFAULT 'bold',
  slides      JSONB NOT NULL,  -- [{index, heading, body, imagePrompt}]
  caption     TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_carousels_user ON carousels(user_id, created_at DESC);

-- profile fields (repurpose brand_voice columns conceptually; add structured profile)
ALTER TABLE users ADD COLUMN profile JSONB;  -- {sells, audience, results[], tone, niche_slug, source_url}
ALTER TABLE users ADD COLUMN packs_used INTEGER DEFAULT 0;      -- monthly, reset with usage_reset_at
ALTER TABLE users ADD COLUMN carousels_used INTEGER DEFAULT 0;  -- monthly
ALTER TABLE users ADD COLUMN sample_pack_used BOOLEAN DEFAULT FALSE;
```

**New `api/_db.js` helpers (exact signatures — implementations follow existing style, `sql` tagged templates):**

```js
// niches & hooks
export async function getNiches()                         // -> rows of niches WHERE active
export async function getHooks({ nicheSlug, format, platform, limit = 50, offset = 0, freeTier = false })
  // JOIN niches; freeTier caps limit at 20 and orders by outlier_score DESC
export async function upsertHook(nicheId, h)              // ON CONFLICT (video_url) DO UPDATE views/score/last_verified
// swipe file
export async function getSwipeFile(userId)                // hooks joined
export async function saveToSwipeFile(userId, hookId)
export async function removeFromSwipeFile(userId, hookId)
export async function swipeFileCount(userId)
// profile
export async function getProfile(userId)                  // users.profile JSONB
export async function saveProfile(userId, profileObj)
// packs & carousels
export async function saveScriptPack(userId, nicheId, title, scripts, sample)
export async function getScriptPacks(userId)
export async function getScriptPack(userId, id)
export async function saveCarousel(userId, hookId, style, slides, caption)
export async function getCarousels(userId)
// gating (replaces canGenerate/consumeCredit semantics)
export async function refreshUsage(user)                   // exists — reuse; also reset packs_used/carousels_used in same UPDATE
export function canGeneratePack(user)    // pro: packs_used < 10; free: !sample_pack_used (sample only)
export function canGenerateCarousel(user) // pro only: carousels_used < 30
export async function consumePack(user, isSample)
export async function consumeCarousel(user)
```

**Steps:**
- [ ] Append migration block to `schema.sql`; write same block to `scripts/migrate-hooklab.sql`
- [ ] Add helpers to `api/_db.js`; delete now-dead helper groups: generations, social connections, post scheduling, single credits kept? — **keep single_credits/processed_checkouts helpers** (webhook still references until Task 14; delete generation/social/schedule helpers now and fix imports)
- [ ] `node --check api/_db.js`
- [ ] Update `refreshUsage` + the inline reset in `getSession` to also zero `packs_used`, `carousels_used`
- [ ] Run migration in Neon console (user action if perms needed — try `node scripts/run-migration.mjs` using POSTGRES_URL from `vercel env pull` first; if no local env, print SQL and ask user to paste in Neon console)
- [ ] Commit: `feat: Hooklab data layer (niches, hooks, swipe_file, script_packs, carousels)`

---

## Phase 2 — Research Engine

### Task 4: YouTube miner helpers + 5x scoring (TDD)

**Files:**
- Create: `api/_youtube.js`, `tests/scoring.test.mjs`

**Interfaces:**
- Produces:
  - `computeOutlierScore(views, followers) -> number` (2dp; followers<=0 → 0; caps at 9999.99)
  - `isOutlier(views, followers) -> boolean` (score >= 5)
  - `async searchShorts(keyword, apiKey) -> [{videoId, title, channelId}]` (YouTube search API, `videoDuration=short`, `order=viewCount`, published last 18 months, max 25)
  - `async getVideoStats(videoIds[], apiKey) -> Map<videoId,{views, title, channelId}>`
  - `async getChannelStats(channelIds[], apiKey) -> Map<channelId,{subscribers}>`

**Steps:**
- [ ] Write `tests/scoring.test.mjs` using `node:test`:

```js
import test from 'node:test';
import assert from 'node:assert';
import { computeOutlierScore, isOutlier } from '../api/_youtube.js';

test('score = views/followers to 2dp', () => {
  assert.equal(computeOutlierScore(1000000, 80000), 12.5);
});
test('zero/negative followers -> 0', () => {
  assert.equal(computeOutlierScore(500, 0), 0);
});
test('caps at 9999.99', () => {
  assert.equal(computeOutlierScore(10_000_000, 1), 9999.99);
});
test('outlier at >=5x', () => {
  assert.equal(isOutlier(400000, 80000), true);   // 5.0
  assert.equal(isOutlier(399999, 80000), false);
});
```

- [ ] Run `node --test tests/` — expect FAIL (module missing)
- [ ] Implement `api/_youtube.js` (pure functions + fetch wrappers over `https://www.googleapis.com/youtube/v3/{search,videos,channels}`)
- [ ] Run `node --test tests/` — expect PASS (network functions not tested; pure functions only)
- [ ] Commit: `feat: YouTube miner helpers with 5x outlier scoring`

### Task 5: `api/mine.js` pipeline

**Files:**
- Create: `api/mine.js`
- Modify: `vercel.json` (add cron), `api/_prompts.js` (add extraction prompt)

**Behavior:**
- `GET /api/mine?secret=$ADMIN_SECRET[&niche=slug][&dry=1]` or Vercel cron (verify `req.headers['x-vercel-cron']` OR secret).
- Picks niche with oldest `last_mined_at` (or the named one). Per run, ONE niche only (timeout budget).
- Pipeline: for each keyword → `searchShorts` → batch `getVideoStats` + `getChannelStats` → filter `isOutlier` → for top 10 new outliers call Gemini once (batched) with extraction prompt → `upsertHook` each → update `last_mined_at`.
- Extraction prompt (add to `_prompts.js` as `HOOK_EXTRACTION_PROMPT`): input = JSON array of `{title, views, followers}`; output JSON array `{hook_verbatim, hook_template, topic, format}`. Template rule: replace specifics with `___` slots ("How I took my client from 150 to 130 lbs" → "How I took my client from ___ to ___"). Format guess from title only is unreliable — default `talking_head`, allow Gemini to pick from enum.
- Transcript enrichment: OPTIONAL per video via `fetchTranscript` (Task 1) wrapped in try/catch; on failure use title only. Cap at 5 transcript fetches per run (Supadata cost).
- `dry=1`: run full pipeline, return JSON of would-be rows, write nothing.
- Errors: per-video try/catch; return `{mined, skipped, errors[]}` summary.

**Steps:**
- [ ] Add `HOOK_EXTRACTION_PROMPT` to `api/_prompts.js`
- [ ] Implement `api/mine.js` per behavior above
- [ ] Add to `vercel.json`: `"crons": [{ "path": "/api/mine", "schedule": "0 6 * * *" }]`
- [ ] `node --check api/mine.js`
- [ ] Verify with `vercel dev` (or deploy preview): `curl "localhost:3000/api/mine?secret=...&niche=fitness&dry=1"` returns candidate rows
- [ ] Commit: `feat: niche mining pipeline (YouTube outliers -> hooks table)`

### Task 6: Seed niches + curated hooks

**Files:**
- Create: `scripts/seed-niches.sql`

**Content:** INSERTs for 4 launch niches with real keyword lists:
- `fitness` — Fitness Trainers: keywords `{how to lose fat, personal trainer tips, gym mistakes, build muscle beginner}`
- `realtors` — Real Estate Agents: `{first time home buyer, realtor tips, sell your house, real estate mistakes}`
- `coaches` — Coaches & Consultants: `{get coaching clients, online coaching business, high ticket offer}`
- `appdev` — App Developers & SaaS: `{how I built my app, indie hacker, app marketing, saas growth}`

Plus ~5 hand-curated hooks per niche (marked `curated = TRUE`) drawn from transcript's known-viral patterns (e.g. franchise-comparison template "How much a ___ owner makes vs a ___ owner", "Not to flex, but I'm pretty good at ___", before/after client result template). Real video URLs found at execution time via YouTube search; if not verifiable, use `views=0, followers=0, outlier_score=0, curated=TRUE` with a `video_url` of the researched example.

**Steps:**
- [ ] Write and run seed SQL (same path as Task 3 migration)
- [ ] Run `/api/mine?niche=appdev&dry=1` then real run for each niche — library populated
- [ ] Commit: `feat: seed launch niches and curated hooks`

### Task 7: `api/hooks.js` — library + swipe file

**Files:**
- Create: `api/hooks.js`

**Interfaces:**
- `GET /api/hooks?niche=slug&format=&platform=&offset=0` → `{ hooks: [...], total, niches: [...] }`. Anonymous OK (top 8, teaser). Free: top 20/niche. Pro: full depth, pagination.
- `GET /api/hooks?swipe=1` → user's swipe file (auth required)
- `POST /api/hooks` body `{action:'save'|'unsave', hookId}` — auth; free tier cap 25 saves (check `swipeFileCount`)
- CORS: this endpoint accepts GET+POST — do NOT use `handleCors` (it 405s non-POST); inline the same-origin CORS logic with `GET, POST, OPTIONS`.

**Steps:**
- [ ] Implement per interface; tier from `getSession` (null = anonymous teaser)
- [ ] Add rewrite `{ "source": "/api/hooks", "destination": "/api/hooks" }` to `vercel.json`
- [ ] `node --check api/hooks.js`; `vercel dev` curl smoke: anonymous returns 8, `?niche=fitness` filters
- [ ] Commit: `feat: hook library API with swipe file`

---

## Phase 3 — Frontend Core

> Invoke `frontend-design` skill before Task 8. All pages share `hooklab.css` + `nav.js`. Design direction: modern, intricate, animated; hooks visibly the product; keep Outfit/IBM Plex Mono unless the design pass decides otherwise.

### Task 8: Design system + landing page

**Files:**
- Create: `hooklab.css` (shared tokens: colors, type scale, buttons, cards, animation utilities)
- Rewrite: `index.html`
- Modify: `nav.js` (links: Library, Studio, Pricing; auth state unchanged)

**Landing page required sections (copy grounded in spec):**
1. Hero — positioning "The $3,000/mo content agency, as software." Animated hook-card shuffle/marquee built from real `/api/hooks` teaser data (fetch on load; graceful static fallback)
2. How it works — 3 steps mirroring Ava's machine: Research (5x rule explainer) → Scripts (hook + YOUR expertise) → Post (faceless carousels for the camera-shy)
3. Live library preview — top hooks across niches, real numbers, links to `/library`
4. Receipts section — "every script traces to a real viral video"
5. Faceless carousels feature block
6. Pricing — Free vs Pro $39/mo table
7. FAQ + footer (privacy/terms links kept)

**Steps:**
- [ ] Invoke `frontend-design` skill; build `hooklab.css` + `index.html` with scroll/entrance animations (IntersectionObserver, CSS only — no libs)
- [ ] Update `nav.js` labels/links; remove workspace/app references
- [ ] Verify: open via `vercel dev`, check hero fetch fallback works with API down
- [ ] Commit: `feat: Hooklab landing page + design system`

### Task 9: Library page + swipe file UI

**Files:**
- Create: `library.html` (route `/library` — re-add rewrite)

**Required UI:**
- Niche tabs (from `/api/hooks` `niches`), format/platform filter chips
- Hook cards: templatized hook (big), verbatim hook, format tag, platform icon, views + followers + `5.2x` score badge, link to source video, Save button (heart) → swipe file
- Swipe file drawer/tab: saved hooks, remove, "Generate scripts from these" CTA → `/studio?hooks=1,2,3`
- Anonymous: teaser rows + blurred overflow + sign-in CTA. Free: top 20 + upsell row for depth. Pro: pagination.

**Steps:**
- [ ] Build page using `hooklab.css`; wire to `/api/hooks`
- [ ] Add `/library` rewrite in `vercel.json`
- [ ] Smoke: anonymous/free/pro states (fake tier via local session)
- [ ] Commit: `feat: hook library UI with swipe file`

---

## Phase 4 — Profile & Script Generation

### Task 10: `api/profile.js` + profile page

**Files:**
- Create: `api/profile.js`, `profile.html` (route `/profile`)
- Delete: `api/brand-voice.js` (lift its `action=fetch` scraper — SSRF guard, Play Store/App Store extraction — verbatim into `profile.js`)
- Modify: `api/auth/me.js` (replace brandVoice summary with `profileComplete: boolean`), `vercel.json`

**Interfaces:**
- `GET /api/profile` → `{ profile }` (auth)
- `POST /api/profile` `{action:'save', profile:{sells, audience, results[], tone, niche_slug}}`
- `POST /api/profile` `{action:'import', url}` → scrape (reused fetcher) → Gemini structuring prompt (`PROFILE_IMPORT_PROMPT` in `_prompts.js`: input scraped text, output `{sells, audience, tone, suggested_niche}`) → return prefill (NOT saved; user reviews)
- Import is free-tier accessible for onboarding, rate-limited 5/day per user (simple in-table counter not needed — cap by checking a `profile_imports` count column? NO — YAGNI: Pro-gate import per spec)

**profile.html:** form (what you sell / who you serve / results list / tone select / niche select), "Import from URL" input + button (Pro badge), save → `/studio`

**Steps:**
- [ ] Write `PROFILE_IMPORT_PROMPT`; build endpoint; delete `brand-voice.js`; update `me.js`, `vercel.json` (`/api/profile`, `/profile`, remove `/api/brand-voice`)
- [ ] `node --check`; smoke import with a real Play Store URL
- [ ] Commit: `feat: business profile with URL import (replaces brand voice)`

### Task 11: Rewrite `api/generate.js` — script packs

**Files:**
- Rewrite: `api/generate.js`, large rewrite of `api/_prompts.js`
- Modify: `api/_db.js` gating (Task 3 signatures already in)

**Interfaces:**
- `POST /api/generate` `{action:'pack', hookIds:[...]|null, nicheSlug, size:3|10|20}` → generates pack. size 3 = free sample (once, `sample_pack_used`); 10/20 Pro. If `hookIds` null → auto-pick top unsaved hooks from niche.
- `POST /api/generate` `{action:'regen', packId, scriptIndex}` → regenerate one script
- `POST /api/generate` `{action:'swap', packId, scriptIndex, hookId}` → new hook, regenerate
- Response scripts match `script_packs.scripts` JSONB shape (Task 3).

**`SCRIPT_PACK_PROMPT` requirements (write fully in `_prompts.js`):**
- Inputs: profile JSON, hooks array (template + verbatim + stats + format), pack size, ratio rule (20 → 16 educational/4 story; 10 → 8/2; 3 → 3/0)
- Per-script output: `notes` (format + how to film, bullet-at-a-time instruction), `bullets[]` (5-9, actionable-specific), `caption` (with CTA slot `[YOUR CTA]`)
- Hard rules embedded: no fluff (spec examples verbatim: "10k steps, TDEE minus 250" style specificity); value ONLY from profile facts; never invent numbers/results; copy hook never video; banned phrases list; no em-dashes; each script carries `sourceStats` string "Hook from a video with 4.2M views (account: 80k followers)" computed server-side, not by the model

**Steps:**
- [ ] Rewrite `_prompts.js` (drop old platform prompts; keep/adapt JSON-repair-friendly structure), rewrite `generate.js` with gating via `canGeneratePack`/`consumePack`
- [ ] `node --check` both; smoke via curl: sample pack for seeded profile returns 3 valid scripts
- [ ] Commit: `feat: script pack generation from library hooks`

### Task 12: Studio page

**Files:**
- Create: `studio.html` (route `/studio`)
- Modify: `pro.js` (upgrade modal copy → single Pro tier, variants: `packs`, `carousels`, `library`), `vercel.json`

**Required UI:**
- Left: hook picker (swipe file first, then niche top hooks; accepts `?hooks=` preselect)
- Generate bar: pack size (3 sample / 10 / 20), Generate button, Pro gates → `pro.js` modal
- Results: script cards — Notes / numbered bullets / caption; per-card copy button, regen button, swap-hook; source-stats receipt line under each hook
- Packs history list (from `getScriptPacks`)
- Carousel tab stub visible with "coming next" state until Task 13 wires it

**Steps:**
- [ ] Build page; wire all three generate actions; free sample flow end-to-end
- [ ] Commit: `feat: studio page for script generation`

---

## Phase 5 — Carousels & Commerce

### Task 13: `api/carousel.js` + studio carousel tab

**Files:**
- Create: `api/carousel.js`
- Modify: `studio.html`, `api/_prompts.js` (`CAROUSEL_COPY_PROMPT`), `api/_shared.js` (add `callGeminiImage`)

**Interfaces:**
- `POST /api/carousel` `{action:'plan', hookId, style}` → Gemini copy pass → saves carousel row → `{carouselId, slides:[{index, heading, body, imagePrompt}], caption}`. Counts 1 against `carousels_used` (plan, not slides).
- `POST /api/carousel` `{action:'slide', carouselId, index}` → ONE image via `gemini-2.5-flash-image` → `{image: dataUrl}` (base64 PNG, not persisted). Auto-retry once server-side on empty/blocked response.
- `callGeminiImage(prompt) -> base64` in `_shared.js`: POST to `models/gemini-2.5-flash-image:generateContent`, `responseModalities: ['IMAGE']`, extract `inlineData.data`.
- Style descriptors (server-side constants): `bold` (high-contrast type-led gradient), `mono` (minimal black/white editorial), `notebook` (hand-drawn paper), `stat` (dark data-card). Each = a prompt prefix ensuring slide-to-slide consistency + "large legible text reading EXACTLY: «{heading}»" instruction.
- Client: requests slides sequentially with progress bar; per-slide retry button; Download All = sequential anchor downloads (no zip dep).

**Steps:**
- [ ] Implement prompt, endpoint, `callGeminiImage`; gate Pro via `canGenerateCarousel`
- [ ] Wire studio carousel tab: pick hook → style picker (4 tiles) → plan → slide-by-slide render grid → download
- [ ] Smoke: full 6-slide carousel generated on preview deploy; verify text legibility; failed slide doesn't kill run
- [ ] Add `/api/carousel` rewrite; commit: `feat: AI faceless carousel generation`

### Task 14: Stripe single-tier swap

**Files:**
- Modify: `api/checkout.js` (remove `$5` single-credit path + `checkout-single` handling), `api/webhook.js` (remove single-credit fulfillment), `api/_db.js` (delete single_credits/processed_checkouts helpers if now unreferenced — verify webhook flow for sub lifecycle still uses processed_checkouts; keep if used), `pro.js` (single tier copy, $39), `vercel.json` (drop `/api/checkout-single` rewrite), `api/auth/callback.js` (drop credit-claim redirect branch if single-credit-only)
- User action: create new $39/mo price in Stripe dashboard → update `STRIPE_PRO_PRICE_ID` env

**Steps:**
- [ ] Trace every reference to `single_credit`, `tg_credit`, `checkout-single` and remove path cleanly
- [ ] `node --check` all touched; Stripe test-mode checkout → webhook → tier=pro round trip on preview
- [ ] Commit: `feat: single Pro tier at $39/mo, remove per-video purchases`

### Task 15: Gating polish, cleanup, smoke checklist

**Files:**
- Modify: `api/auth/me.js` (return `packsUsed`, `carouselsUsed`, `samplePackUsed`, `profileComplete`), `nav.js` (Pro badge, usage), `index.html` pricing wiring to real checkout
- Create: `docs/superpowers/smoke-checklist.md`

**Smoke checklist contents (run each on preview deploy):**
- [ ] Anonymous: landing loads, hero animation, library teaser, sign-in works
- [ ] Free: browse 20/niche, save 25 max (26th blocked w/ upsell), sample pack once (second blocked), import gated
- [ ] Pro (test-mode sub): full library, 10-pack generates, regen + swap work, carousel plan+slides+download, caps enforced at 10/30
- [ ] Miner: cron config present, manual dry run + real run
- [ ] Stripe: checkout, webhook tier flip, billing portal, cancel → downgrade
- [ ] All pages: no `TranscriptGrab` string, no dead links, CSP clean console

**Steps:**
- [ ] Implement, run checklist, fix failures
- [ ] Commit: `chore: gating polish + launch smoke checklist`

---

## Post-v1 (explicitly deferred)

- TikTok Apify enricher (`mine.js` `source=tiktok` branch)
- Scheduling/social OAuth (v1.1, needs platform dev-app approvals)
- Niche self-serve requests UI (request button can mailto for now)

## Owner external todos (blocking launch, not code)

1. `YOUTUBE_API_KEY` — Google Cloud console, YouTube Data API v3
2. `ADMIN_SECRET` — any random string, Vercel env
3. New Stripe $39/mo price → `STRIPE_PRO_PRICE_ID`
4. Domain + Vercel project rename + Google OAuth consent name + Stripe business name
