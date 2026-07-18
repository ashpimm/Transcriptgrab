# Autopilot → Past carousels mirror

**Date:** 2026-07-18 · **Approved:** user picked approach A

## Problem

Autopilot generates and publishes carousels invisibly. They never appear in the
create page's "Past carousels" list, so the user can't reopen one, download the
ZIP, or manually cross-post it to TikTok (not linked to upload-post).

## Design

At publish time in `api/autopilot.js` phase 1, immediately after a successful
`uploadPhotos` + `setPostStatus(post.id, 'posted', …)`, mirror the post into the
`carousels` table using existing helpers:

1. `saveCarousel(post.user_id, null, post.style, post.slides, post.caption, false, post.hero_scene)` — no hook_id, never watermarked (paid).
2. `saveCarouselBg(post.user_id, row.id, bgB64)` — the background is already in
   hand from the publish render; caching it makes history revisits free.
3. `saveCarouselHero(post.user_id, row.id, heroB64)` when a hero exists.

Mirror failures are logged and swallowed — the post is already live on socials;
history bookkeeping must never mark a published post as failed or trigger the
retry path.

No UI changes: create.html's `loadHistory()` already lists carousels rows,
click-to-reopen renders from cached bg/hero (accent falls back to profile
color), and Download ZIP (slides + caption.txt) already works.

## Rejected

- **B** merge `posts` into history API: images weren't stored, so every revisit
  regenerates backgrounds (Gemini cost) or shows plain slides.
- **C** separate autopilot page + server ZIP endpoint: new UI + endpoint for
  what A gives free.

## Testing

No DB-mock harness exists in this repo (suite tests pure functions only);
mirroring is a straight 3-call sequence of existing tested-in-prod helpers.
Verify: suite stays green, next autopilot publish shows up in Past carousels.
