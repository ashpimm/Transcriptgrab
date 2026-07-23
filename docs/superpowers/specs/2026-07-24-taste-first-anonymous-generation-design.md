# Taste-First Anonymous Generation — Design

**Date:** 2026-07-24
**Status:** Approved for planning
**Owner:** Promote.dev

## Problem

A cold stranger cannot see a single generated post without first signing in with
Google (`index.html` hero paste → `/api/auth/google`; `create.html:1217` hard auth
gate). The landing promises "3 free posts, no card" but a login wall sits before any
taste. This is the largest drop point in the funnel: visitors bounce before they ever
see the product make something for *their* app.

## Goal

Let a cold visitor paste their product link and receive a **complete real post**
(six designed slides + AI cover photo + caption + hashtags) for their own product
**without signing in**. They sign in only to download or keep it — and when they do,
the post they just made is already in their account.

Non-goals: changing the generation pipeline itself, changing pricing, or building
distribution/traffic (tracked separately — see memory `self-marketing-engine`).

## Decisions (locked)

- **Free taste = full post, including AI cover photo** (pixel-identical to the paid
  preview). Maximum first-impression impact.
- **Global daily ceiling: 75 anonymous posts/day** (env `ANON_DAILY_CAP`, default 75).
  The primary defense against distributed/botnet abuse. When hit, anonymous generation
  falls back to the current sign-in-first gate; paid and logged-in users are never
  affected.
- **Per-IP limit: 1 ever** (not a rolling window). Tightest wallet protection; a given
  IP gets exactly one free anonymous post, then must sign in (which still grants the
  normal 3 free posts).
- Anonymous posts are **always watermarked** (same as the free tier) to preserve the
  reason to pay for Pro.

## Architecture

### 1. Anonymous identity

On the first anonymous action, the server issues an `anon_id` cookie: a random
64-hex token, `HttpOnly; Secure; SameSite=Lax`, 30-day Max-Age — mirrors the existing
`tg_session` cookie mechanics (`api/_db.js:37`). It is **not** a session and grants no
user privileges. Its jobs:

1. Tie the multi-step generation (import → plan → cover → slide render) to one subject.
2. Let the result be claimed onto a real account at signup.

A request is treated as "anonymous-authorized" when it has no valid `tg_session` but
does have a valid `anon_id` that owns an active, unclaimed slot.

### 2. Abuse throttle (two layers)

A new table `anon_slots` records every reserved anonymous generation:

```
anon_slots (
  id           SERIAL PRIMARY KEY,
  ip_hash      TEXT NOT NULL,          -- sha256(salt + trusted client IP)
  anon_id      TEXT NOT NULL,          -- the anon cookie token
  carousel_id  INT NULL,               -- filled when generation completes
  status       TEXT NOT NULL,          -- 'reserved' | 'complete' | 'released'
  claimed_by   INT NULL,               -- user id once claimed on signup
  created_at   TIMESTAMPTZ DEFAULT NOW()
)
```

Indexes on `ip_hash`, `anon_id`, and `(status, created_at)`.

**Client IP** comes from Vercel's trusted `x-real-ip` header (never raw
`x-forwarded-for`, which is client-spoofable). Hashed with a server-side salt env
`ANON_IP_SALT` so raw IPs are never stored.

**Slot reservation happens at import start** — the first money-costing step
(scrape + LLM), not at the image step — so bots cannot spam import for free. The gate:

1. If a valid session exists → normal authenticated path, skip all anon logic.
2. Else require a valid `anon_id`; if none, mint one.
3. **Per-IP check:** if any `anon_slots` row exists for this `ip_hash` with status
   `complete` → refuse (this IP already had its one taste). Return a signal the
   frontend renders as the sign-in gate.
4. **Global check:** if `COUNT(*) WHERE status='complete' AND created_at::date = today`
   ≥ `ANON_DAILY_CAP` → refuse with the same gate fallback.
5. Otherwise insert a `reserved` slot and proceed.

A `reserved` slot that never completes is released (see Error Handling), so a failed
import does not consume the IP's single lifetime taste.

### 3. Session-optional pipeline

`/api/profile` (import + save) and `/api/carousel` (plan / background / hero) already
resolve `getSession(req)`. They gain a shared resolver:

```
resolveActor(req) → { kind: 'user', user } | { kind: 'anon', anonId, slot } | null
```

- `kind: 'user'` — unchanged behavior.
- `kind: 'anon'` — the profile and carousel are written against `anon_id`, not a
  `user_id`. All anon carousels are forced `watermark = true`. The anon actor may
  create at most the one post its reserved slot allows.
- `null` — no session and no valid anon authorization → the endpoint refuses with the
  gate-fallback signal.

`carousels` and the profile store gain a nullable `anon_id TEXT` column; `user_id`
becomes nullable for anon rows (or anon rows live with `user_id NULL` + `anon_id` set).
Every existing authenticated query filters on `user_id`, so anon rows are invisible to
normal history reads until claimed.

### 4. Claim-on-signup (conversion)

The Google OAuth callback (`api/auth/google.js`) already runs `upsertGoogleUser` +
`createSession`. After the user row is resolved, it checks for an `anon_id` cookie:

1. Find the `anon_slots` row for that `anon_id` with `status='complete'` and
   `claimed_by IS NULL`.
2. If found, in one transaction: set `claimed_by = user.id`; move the anon carousel to
   `user_id = user.id` (clear `anon_id`); if the user has no profile yet, adopt the anon
   profile; increment the user's free-post count so the claimed post counts as free
   post #1 of 3.
3. Clear the `anon_id` cookie.

Result: the new user lands in `/create` with their product profile set and their
freshly generated post already in "Recent posts," one click from download.

Claiming is idempotent and safe if the cookie is stale/mismatched (no matching
unclaimed slot → no-op).

### 5. Frontend flow

**Landing (`index.html`):**
- Hero paste (`#hero-paste`, line ~558) stops routing to `/api/auth/google`. It stashes
  the URL and navigates to `/create`, which auto-runs anonymous generation.
- Signed-in redirect logic (line ~538) is unchanged.

**Create (`create.html`) — behavior:**
- The hard auth gate (`#gate`) no longer blocks first use. Anonymous visitors see the
  full studio and may complete exactly one post.
- Import + generate run against the anon endpoints. On success the output renders
  exactly as it does for logged-in users, watermarked.
- Download, "make another," and any second generation trigger a **sign-in prompt**:
  "Sign in free to download this post and make 2 more." Framed around the asset they
  are already looking at.
- When the per-IP limit or global cap refuses generation, the classic sign-in gate is
  shown instead of the studio (graceful, honest fallback).

### 6. Create-page copy & layout redesign

The current create page front-loads explanation the user no longer needs once they can
see real output. It sells the deliverables ("6 designed slides", "1 ready caption",
proof chips, the empty six-slide deck illustration, the "One click. One complete post."
pitch) *before* anything exists. With taste-first, the output itself is the pitch.

Redesign principles:

- **Output-first for anonymous first-timers.** The fastest possible path is: paste →
  generating → real post. Collapse or de-emphasize the explanatory `deck-preview`,
  `deliverables`, and proof chatter on first load; they pre-sell something now shown for
  real seconds later.
- **Move the "how it works" copy below or beside the result**, not ahead of it. After a
  visitor has seen their own post, a short "here's what just happened / what's included"
  line is reassurance, not a sales pitch — and it can carry the sign-in CTA.
- **Trim the profile step wording.** The two-panel "01 Your product / 02 Build the post"
  scaffolding explains the machine before the user cares. For a first-time anon visitor,
  reduce to: paste link → (we read it) → post. Keep the editable profile, but secondary.
- **One primary action visible at a time.** Paste is the only thing that matters until
  there's a profile; "Create my complete post" is the only thing that matters until
  there's output; download + sign-in is the only thing that matters after.
- Preserve all existing capability (manual profile entry, hook/style customize, edit
  profile, history) — demote, don't delete. Logged-in returning users still get the full
  studio; the trimming is about first-run clarity, not feature removal.

Exact layout/copy to be decided during implementation with the design skills; this spec
fixes the intent: **stop explaining what the user is about to see, and let them see it.**

## Data / schema summary

- `carousels`: add `anon_id TEXT NULL`; allow `user_id NULL` for anon rows.
- Profile store: add `anon_id TEXT NULL` (anon profiles live here until claimed).
- New table `anon_slots` (above).
- New env: `ANON_DAILY_CAP` (default 75), `ANON_IP_SALT` (required secret — user
  generates it; never generated for him).

## Error handling & edge cases

- **Generation fails midway** → the reserved slot is set to `released`; the IP's single
  lifetime taste is not consumed by our own error.
- **Import spam** → gated at import start by the same per-IP + global checks, so it cannot
  be used to burn LLM budget for free.
- **IP spoofing** → uses Vercel's trusted `x-real-ip`; raw `x-forwarded-for` is ignored.
- **Shared IP (office / mobile CGNAT)** → one person on that IP gets the taste; others
  hit the sign-in gate, which still grants the normal 3 free posts. Nobody is fully
  blocked from the product.
- **Stale / mismatched `anon_id` at signup** → claim is a safe no-op.
- **Global cap reached** → anonymous requests get the sign-in gate; logged-in and paid
  flows are untouched.
- **Abandoned anon posts** → rows with `claimed_by NULL` older than N days can be pruned
  by a later cleanup (not required for v1; storage is small).

## Success criteria

- A logged-out visitor can paste a product link and see a complete, watermarked post for
  their product without any account.
- That visitor can sign in and find the same post + profile already in their account,
  counted as free post #1.
- A second anonymous attempt from the same IP is refused and shown the sign-in gate.
- Total anonymous full posts cannot exceed `ANON_DAILY_CAP` per day.
- Logged-in and paid flows are unchanged.
- The create page leads with action/output, not explanation, on first run.
```
