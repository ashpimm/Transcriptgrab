# Hero slide — a real photograph on the hook slide

**Date:** 2026-07-13
**Status:** approved

## Problem

Every slide in a carousel sits on ONE textless abstract background (`backgroundPrompt`,
`api/_generate.js`). That prompt asks for "stylized illustrated motifs … abstract and
decorative, near the edges" with a quiet empty middle. The result is a symbol plane: six
slides of text floating on the same decorative wallpaper. Nothing about the image says what
the post is *about*.

A hook about beating phone addiction should open on a hand dropping a phone into a drawer.
A hook about fitness tracking should open on someone glancing at their watch mid-run. That
is what stops a scroll.

## Design

### 1. The scene comes from the copy call (no extra API spend)

`CAROUSEL_COPY_PROMPT` gains one output field, `heroScene`: a *photographable* moment that
literally depicts slide 0's claim. Prompt rules force it to be shootable — a person, hands,
or a physical object, doing something, in a real place. Never a phone screen or app UI,
never text or logos, never an unphotographable metaphor. Max ~20 words.

It is persisted (`carousels.hero_scene`, `posts.hero_scene`) so history views and the
autopilot cron re-render the same scene instead of inventing a new one.

### 2. `heroPrompt()` — a fixed cinematic recipe

New export in `api/_generate.js`, beside `backgroundPrompt`. Deliberately **not**
style-dependent: photorealistic editorial photograph, one clear subject, shallow depth of
field, natural directional light, muted filmic grade, dark understated surroundings.
Composition constraint: subject in the lower two thirds, top third quiet and dark so the
hook text has somewhere to live. One natural element may carry the brand accent if known.
Hard negative list: no illustration, no 3D render, no text/letters/logos/UI.

Returns `''` when there is no scene (legacy carousels) — the caller then skips the hero call
entirely and slide 0 falls back to today's abstract background. No hard failure, ever.

### 3. Rendering — `opts.hero` in `slide-render.mjs`

Today's overlay is a flat full-canvas wash: `rgba(13,16,20,0.62)` for `bold`,
`rgba(250,250,247,0.88)` for `mono`. Either would destroy a photograph — the first muddies
it, the second erases it. So the hero slide swaps it:

- **Gradient scrim** instead of a flat wash, **sized from the text that was actually laid
  out**. The first cut used a fixed gradient tuned for a 3-line hook while the layout permits
  6 — lines 4-6 landed in white on bare photo. The overlay is therefore painted *after* the
  type is measured (measuring touches no pixels, so text slides render identically), and the
  hero additionally holds to 4 lines so a long heading can't bury the image.
- **Top-anchored text** instead of centred, so the subject breathes in the lower frame.
- **White ink**, fixed, independent of the style theme (the photo is always dark).
- Accent bar carries the brand, and is **lifted toward white when the brand colour is dark** —
  a navy bar on a near-black scrim is an invisible bar, and it's the cover's only brand mark.

Consequence, accepted: on `mono` / `notebook` (paper styles) the carousel becomes a dark
photo cover followed by five light text slides. That is the standard IG cover-then-text
pattern, and the accent bar bridges it.

Slides 1..N are untouched. `stat` keeps its mono font on the hero, `bold`/`mono`/`notebook`
keep sans.

### 4. API — two requests, not one

The first cut fetched both images in one `action:'background'` call and returned them in one
JSON body. Code review killed that: it let a failed hero `UPDATE ... hero = NULL` over a good
cached one, it never retried a hero that failed once (the cache branch keys on `bg` alone),
and two base64 PNGs in one response — a photograph compresses far worse than flat abstract
art — flirts with Vercel's ~4.5MB function response cap.

So they are separate, independently cached, independently retried:

- `action:'background'` → `{ image }`, the art every TEXT slide sits on. Load-bearing; a
  failure is a 500, as it was before this change.
- `action:'hero'` → `{ hero }` or `{ hero: null, reason }`. Best-effort by construction: it
  never 500s, because a null hero is just slide 0 on the background — what every carousel
  looked like before this existed.

The client fires both in parallel, paints as soon as the background lands, and upgrades
slide 0 when the photograph arrives.

The scene is read from the carousel row server-side, never accepted from the client — it goes
straight into an image prompt, so it must not be user-controllable. `cleanScene` additionally
drops any scene naming text, logos, URLs or instructions: profile fields are free text and a
scraped URL can carry anything, and on the autopilot path the image posts to a real account
unreviewed. No photo beats a photo with someone else's billboard in it.

### 5. Autopilot

`api/autopilot.js` renders the same pair in parallel before `renderSlidePngs`, which now
takes `heroBase64` and uses it for slide 0 only. Both calls go through the shared
`callGeminiImageRetry` — this subscriber never sees the post before it publishes and cannot
re-roll it, so a single transient Gemini blip must not silently downgrade their cover. A hero
that still fails degrades to the background; it never fails a scheduled post.

### 6. Storage

`scripts/migrate-hero.sql` (idempotent, run **after** `migrate-autopilot.sql` since it
touches `posts`):

```sql
ALTER TABLE carousels ADD COLUMN IF NOT EXISTS hero       TEXT;
ALTER TABLE carousels ADD COLUMN IF NOT EXISTS hero_scene TEXT;
ALTER TABLE posts     ADD COLUMN IF NOT EXISTS hero_scene TEXT;
```

The two images are written by **separate statements** (`saveCarouselBg`, `saveCarouselHero`)
and never in one `UPDATE`: each is a separately-bought asset, and neither may null the other.

A push auto-deploys but the SQL is run by hand, so the writes that name the new columns fall
back to the pre-hero statement on `column ... does not exist` and log loudly. A deploy landing
ahead of its migration costs cover photos, not the whole product.

### 7. Client

`create.html` caches `{bg, hero}` per carousel, draws slide 0 from the hero when present,
and the "New background" button becomes **"New visuals"** (it re-rolls both).

## Cost

Two image calls per carousel instead of one: ~$0.04 → ~$0.08. Copy, gating, watermark,
slide count: unchanged.

## Non-goals

- Per-slide unique images (already rejected: 6× spend, flat result).
- Style-graded heroes (considered; a single cinematic grade is more striking and one less
  thing to get wrong).
