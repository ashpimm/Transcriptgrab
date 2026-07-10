# Vibecoder Pivot — Design Spec (2026-07-10)

## One-liner

"You vibecoded an app. This markets it — faceless." Paste your app's URL, get a
finished, postable faceless carousel (slides + caption + hashtags) built on hook
templates proven to outperform (5x outlier rule, with receipts).

Supersedes the library-first / script-pack product defined in
`2026-07-03-hooklab-rebuild-design.md`. Backend plumbing (auth, billing, miner,
carousel gen) carries over; product framing, UI, and pricing are replaced.

## Why (problem statement)

Owner is customer zero: ships vibecoded apps fast, but can't market them —
finding viral hooks is hard, filming is a non-starter. Same pain is shared by
the indie-hacker / vibecoder crowd broadly. The previous product ($39/mo script
packs for an imagined agency persona) had no validated customer, no visible
output at purchase time ("scripts are homework"), and no viral loop.

## Positioning

- **Audience:** indie hackers / vibecoders. Zero followers, no camera, broke.
- **Message:** narrow and loud — homepage speaks directly to devs marketing
  their own apps. Other niches (fitness, realtors, coaches) keep mining in the
  background but stay hidden until a later expansion.
- **Name:** TBD (parked deliberately). Codename remains Hooklab. Domain, Stripe
  product names, OAuth app names all wait for the real name.

## Core loop

1. Paste app URL on landing page.
2. Server fetches the page, Gemini extracts a draft app profile
   (name, what it does, who it's for, key benefit).
3. User confirms/edits the profile card (prefill + confirm; graceful
   degradation to a manual form if scraping fails or the page is thin).
4. Pick a proven hook from the feed (or auto-pick), pick a visual style.
5. Generate: 5–6 slide faceless carousel + ready-to-paste caption + hashtags.
6. Download slides (ZIP) / copy caption → post anywhere.

Free carousels carry a small "made with [name]" watermark on the last slide —
every free post is distribution (the OpusClip trick).

## Pages (full UI rebuild; raze all current pages)

- **index** — hero: URL paste box + "get your first carousel free" (no card).
  Below: live outlier feed strip (real appdev/tech videos embedded, 5x stats as
  receipts), how-it-works, pricing, watermarked example carousels.
- **feed** (replaces library) — public. Appdev/tech niches visible at launch.
  Each hook card: template + real YouTube embed + views / followers / outlier
  score. Rows with `curated://` placeholder URLs are excluded from display
  (no receipts, no show).
- **create** (replaces studio) — profile card at top, hook picker, style
  picker (keep 4 styles: bold / mono / notebook / stat), generate → carousel
  viewer + caption block + ZIP download + copy-caption.
- **account** (replaces profile page) — plan, usage, credits, billing portal.
- **privacy / terms** — carried over, reskinned.

## Pricing & gating

| Tier | Price | Allowance | Watermark |
|------|-------|-----------|-----------|
| Free | $0 | 1 carousel ever (no card required) | Yes |
| Pro | $9/mo | 20 carousels/mo | No |
| Credits | $5 one-time | 8 carousels, no expiry | No |

- Both purchase paths live side by side (subscription + one-time credit packs).
- Unit economics: carousel ≈ $0.20–0.30 Gemini image cost. Pro worst case
  ≈ $6 cost on $9 revenue; credits ≈ $2.40 cost on $5.
- Removed: $39/mo tier, sample script pack, script-pack quotas.

## Backend

### Endpoints (9 of 12 Vercel Hobby function slots)

| Endpoint | Change |
|----------|--------|
| auth/google, auth/callback, auth/me | unchanged |
| checkout | gains one-time credit-pack mode alongside subscription |
| webhook | handles both subscription and one-time payment events |
| hooks | feed queries; excludes `curated://` rows from public display |
| profile | gains URL-scrape: fetch page → Gemini extract → return draft profile; saves confirmed app profile |
| carousel | absorbs caption + hashtag generation (former scripts code) |
| mine | unchanged; appdev niche gets priority |
| **generate** | **deleted** (script packs dead) |

### DB (migration SQL required)

- `users.profile` JSONB repurposed → `{app_url, name, what, who, benefit, tone}`.
- `users.credits` int added (default 0).
- `packs_used` / `sample_pack_used` obsolete; `carousels_used` remains for Pro
  monthly quota.
- `script_packs` table dormant (kept in DB, code removed) — same treatment as
  the previous rebuild's dormant tables.
- `hooks`, `niches`, `swipe_file`, `carousels` unchanged.

### Miner

Unchanged mechanics (daily cron, 5x rule, transcript-enriched Gemini
extraction). Appdev/tech niches prioritized for staleness rotation so the
public feed stays fresh where the audience looks.

## Visual system

- **Direction:** faithful adaptation of opus.pro — lift palette, type scale,
  and layout patterns near-directly; swap content for ours.
- **Process:** screenshot opus.pro via headless Chrome first; extract real
  palette / typography / spacing from pixels, not memory. Then rebuild
  `hooklab.css` tokens from that extraction.
- **Flair:** subtle scroll animations — IntersectionObserver fade/rise-ins,
  gentle parallax on hero cards. Must respect `prefers-reduced-motion`.
- **Mobile:** verify with CDP `Emulation.setDeviceMetricsOverride` (true 390px),
  not `--window-size` (known ~500px artifact).

## Out of scope (explicitly later)

- Faceless **video** generation (TTS + captions + visuals) — phase B, after
  carousels prove out.
- Auto-posting / social OAuth (unchanged from previous spec: v1.1+).
- Niche expansion beyond appdev/tech.
- Rename: domain purchase, Vercel project rename, Stripe/Google OAuth naming —
  all blocked on the name decision, deliberately parked.

## Success criteria

- Owner (customer zero) can take one of his own apps from URL → posted
  carousel in under 5 minutes without touching a camera.
- Landing page communicates the pitch in one screen: paste box + receipts.
- Free → paid path exists end to end (watermark → $9/mo or $5 credits).
- All function count ≤ 12, no build system introduced, vanilla stack retained.
