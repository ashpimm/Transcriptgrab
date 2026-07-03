# Hooklab — Rebuild Design

**Date:** 2026-07-03
**Status:** Approved by user (brainstorm session)
**Supersedes:** TranscriptGrab product (0 users, DOA) and pending "PostMaxx" rebrand

## What & Why

Rebuild TranscriptGrab into **Hooklab**: a short-form content agency in a box, modeled on the playbook from the Ava Jurgens transcript (`docs` reference: uploaded interview). Her $2-4k/mo done-for-you service reduces to a repeatable machine:

1. **Research** — find "outlier" videos in a niche (5x rule: views ≥ 5× the account's followers), catalog their hooks/topics/formats
2. **Scripts** — viral hook + the client's own expertise as the value
3. **Double down** — recreate what worked in new formats

The research is cacheable per niche (she spends 10-12 hrs/month *per client*; software does it once per niche for all users). The scripting is promptable. The differentiator vs generic AI tools: **every output traces to a real viral video with real numbers** — the receipt.

Existing repo keeps its proven plumbing (Google OAuth, Stripe, Neon Postgres, Gemini integration, URL scraper). Social posting/scheduling and brand voice were never actually functional and are cut from v1.

## Target users

1. **Business owners with expertise to sell** (trainers, realtors, coaches — Ava's exact market, can't afford $2-4k/mo)
2. **Solo devs marketing their apps** who have never done social media (owner is customer zero)

For camera-shy users (esp. devs): **faceless AI-generated carousel content** — removes the #1 churn reason Ava names ("people who don't end up filming").

## Product spine: Library-first

The Hook Library is the front door and the free tier. Generation is the Pro tier behind it. Name must live up: hooks are visibly the product.

### UX flow

- **Landing page** — live library preview with real hooks/view counts/5x scores. Positioning: "The $3,000/mo content agency, as software." Modern, intricate, animated (see Visual Overhaul).
- **Library** (free) — hook cards filterable by niche/format/platform. Card: templatized hook, original video link, views, account followers, 5x score, format tag (talking head / whiteboard / audio B-roll / skit), platform. Save to personal **swipe file**.
- **Business profile** — digitized client-onboarding doc: what you sell, who you serve, citable results/case studies, tone. **Import from URL**: paste Play Store / App Store / website link → scraper (lifted from `brand-voice.js`, SSRF-guarded) → Gemini extracts structured fields → prefilled form user reviews/edits.
- **Generate** (Pro) — pick hooks (or auto-pick) → script pack, or faceless carousel.
- **Export-first shipping** — download images, copy scripts/captions, post manually. No social OAuth/scheduling in v1 (external dev-app approval blockers). Scheduling returns v1.1.

## Research & data pipeline

- **Niches**: fixed starter set (launch with 4: fitness trainers, realtors, coaches, app devs/SaaS). Each = config of search keywords + seed creator channel IDs. Users can request niches.
- **YouTube miner** (primary): YouTube Data API search Shorts by keywords + seed creators → compute 5x score (views / channel subscribers) → outliers (≥5) get Gemini pass: extract verbal hook (title + Supadata transcript), classify format, templatize hook → store in `hooks` table.
- **TikTok enricher** (secondary): Apify actor per niche keyword, monthly, same table. Cost bounded by per-niche caching (~$5-20/mo). Product functions on YouTube data alone if Apify flakes.
- **Curated seed**: ~20-30 hand-verified hooks per launch niche so library never looks empty.
- **Freshness**: monthly re-mine per niche (Vercel cron, Hobby allows daily), `last_verified` on hooks, sort by score + recency. "Top hooks this month" pages = free shareable/SEO surface.
- Costs: YouTube API free quota ample; Gemini pennies.

## Generation

### Script packs
Input: chosen hooks + business profile. Gemini 2.5 Flash (existing `callGemini`). Per script:
- **Notes** — format + how-to-film guidance
- **Script** — bullets (filmed one bullet at a time)
- **Caption** — with CTA slot

20-pack ratio: 16 educational / 4 storytelling (her ratio). Prompt rules (from transcript):
- No fluff — actionable specifics ("10k steps, TDEE minus 250", not "walk more")
- Value only from user's profile facts/case studies; never invent results
- Copy the hook, never the video
- Banned AI-tells: "here's the truth", "skyrocket", "game-changer", em-dashes
- Every script cites its source hook with real numbers
- Per-script **regenerate** and **swap hook**

### Faceless carousels (AI image gen, Pro-only)
- Gemini writes slide copy: hook slide → 3-6 value slides → CTA slide
- Images: `gemini-2.5-flash-image` (best-in-class in-image text rendering), ~$0.04/image, ~30-40¢ per carousel
- Consistency: shared style descriptor + slide 1 fed as style reference for slides 2-N
- Per-slide regenerate button; failed slides don't count against cap
- Client requests **one slide per API call** (dodges Hobby timeout, natural progress UI)
- Output 1080×1350 PNG set + caption (IG carousel + TikTok photo mode)
- Fallback if quality disappoints in practice (not built preemptively): AI background + programmatic text overlay

## Architecture

Vanilla HTML/CSS/JS frontend, no build system (unchanged). Vercel serverless, Hobby plan.

**Function budget — 10 of 12 slots:**

| Endpoint | Role |
|---|---|
| `auth/google.js`, `auth/callback.js`, `auth/me.js` | unchanged |
| `checkout.js`, `webhook.js` | Stripe, single Pro tier |
| `hooks.js` | GET library w/ filters + swipe-file save/unsave |
| `profile.js` | profile CRUD + `?action=import` URL scraper |
| `generate.js` | script packs + per-script regen |
| `carousel.js` | slide copy + per-slide image gen |
| `mine.js` | research pipeline; Vercel cron + manual admin trigger |

Deleted: `social.js`, `social-callback.js`, `schedule.js`, `brand-voice.js` (absorbed into `profile.js`). `transcript.js` demotes to internal helper used by miner.

**DB:** keep `users`, `sessions`. New: `niches`, `hooks`, `swipe_file`, `script_packs`, `carousels`. Social/schedule/generations tables dropped or dormant.

**Pages:** landing, library, profile, studio (generate + results). Old pages/redirect stubs removed.

## Pricing & gating

- **Anonymous**: landing library preview
- **Free**: full library browse (top ~20 hooks/niche), swipe file ≤25 hooks, one 3-script sample pack, no card
- **Pro $39/mo**: full library depth, 10 script packs/mo, 30 carousels/mo, profile URL import
- Enforcement server-side in `generate.js`/`carousel.js` (same pattern as current credit checks)

## Error handling

- Carousel: per-slide isolation; auto-retry once → manual retry button; failures don't count vs cap
- Miner: per-video try/catch, partial runs commit; quota exhaustion resumes next cron
- Profile import failure → "paste manually" fallback
- Gemini malformed JSON → one strict retry → visible error, never silent junk

## Testing

No test framework in repo; staying honest: plain-node unit tests for pure logic only (5x scoring, hook templatizer parsing, gating math). Manual smoke checklist per launch step. Miner `--dry-run` flag prints instead of writes. No test theater.

## Visual overhaul

Full rebrand + redesign to match new name. Direction: **modern and intricate landing page with animation** — distinctive, not templated. `frontend-design` skill to be invoked at implementation time; owner delegated aesthetic judgment ("take the wheel"). Existing Outfit + IBM Plex Mono / monochrome system may be evolved or replaced at design time.

## Launch order

1. Rebrand sweep (TranscriptGrab → Hooklab) + delete dead endpoints/pages
2. DB migration (new tables)
3. Miner + seed 4 launch niches
4. Library UI + swipe file
5. Profile + Play Store import
6. Script generation
7. Carousels
8. Stripe single-tier swap + new landing page
9. Ship. v1.1: scheduling/posting once platform dev apps approved

## Out of scope (v1)

- Social OAuth, scheduled/auto posting (v1.1)
- Video editing of any kind
- Email list, ManyChat-style funnels
- Niche self-serve creation (request-only)

## Owner's external todos

- Buy hooklab domain (verify availability)
- Rename Vercel project (URL follows automatically); add custom domain
- Update Google OAuth consent screen name
- Update Stripe product/business name
