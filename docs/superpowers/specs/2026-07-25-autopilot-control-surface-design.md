# Autopilot Control Surface — Design

**Date:** 2026-07-25
**Status:** Approved by user (dedicated page, editable queue, NO approval gating)

## Problem

Autopilot has no user-facing controls. It auto-activates silently (pro tier +
Instagram connected + profile saved → `getAutopilotUsers` picks the user up),
posts at a hardcoded time (20:00 UTC slot / 20:30 UTC cron), and the queue on
the account page is read-only. Users cannot turn it on/off, choose a posting
time, or see/edit what is about to be published. Analytics (Measure loop,
126a741) exists but is crammed into the 640px account page with billing.

## Solution overview

A dedicated `/autopilot` page that owns the whole publishing loop, plus the
minimal backend to make it controllable: an enable toggle, a posting-time
slot, and queue mutation (edit / skip). No approval gating — posts publish
automatically unless the user opts to touch them.

## 1. Page structure

New `autopilot.html`, served at `/autopilot` (vercel.json rewrite). Nav gains
an "Autopilot" link. Account page slims to identity, plan/usage, billing,
signout.

Page sections, top to bottom:

1. **Status header** — large on/off toggle + the existing automation-health
   strip (moved from account). Off = topup stops generating for the user AND
   publish holds their queued posts (nothing goes out, queue preserved).
2. **Connection card** — Instagram/TikTok linked chips + "Link / manage
   accounts" button (moved from account).
3. **Schedule card** — posting-time slot picker (see §2).
4. **Queue** — future posts (status `queued`) with real slide previews
   (reuses the `slideCard` renderer from account.html), each expandable into
   an editor (see §3).
5. **History & performance** — the analytics card moves here wholesale
   (totals strip, per-platform metrics, refresh button).

States:
- **Free user:** page renders as upsell — feature explanation + $19 CTA.
  Doubles as a sales surface.
- **Pro, not connected:** connection card leads; toggle/schedule/queue shown
  disabled with "connect first" copy.
- **Pro + connected:** full surface.

## 2. Scheduling

Constraint: Vercel Hobby crons fire at fixed daily UTC times — free-form
per-user times are impossible. Solution: discrete slots that map 1:1 to cron
fire times, so the promise "posts at 6:00 AM" is exact, not "sometime after".

- Publish crons at **20:30, 02:30, 08:30, 14:30 UTC** (4 entries in
  vercel.json, all rewriting to `/api/autopilot?mode=publish`). 20:30 is the
  existing cron and stays the default — the owner's 6 AM Adelaide flow is
  unchanged.
- The dedicated `autopilot-recovery` cron (22:00 UTC) is **dropped**: every
  publish fire already sweeps due + submitted posts, so 4 fires/day provide
  built-in recovery. Total crons: 7 (mine, topup, topup-recovery, publish×4).
- UI shows the 4 slots converted to the visitor's local timezone via JS
  (`Intl.DateTimeFormat`), user picks one.
- New column `users.post_slot TEXT DEFAULT '20:30'` (UTC "HH:MM", validated
  against the allowed slot list server-side).
- `nextSlots(nowIso, existing, days, slot)` gains a slot parameter and uses
  it instead of the hardcoded `setUTCHours(20, 0, 0, 0)`. Same pattern as
  today: scheduled_at = cron fire time minus 30 minutes (20:00 for the
  20:30 cron), so `claimDuePosts` (scheduled_at <= now) picks the post up
  on its intended fire and never on the one before.
- Changing the slot only affects **future generated posts**; already-queued
  posts keep their scheduled_at (next topup fills future days at the new
  slot). Simple, avoids rescheduling races. UI copy states this.

Risk: if Vercel Hobby rejects 7 crons at deploy, fallback = 2 publish slots
(20:30, 08:30 UTC) — same UX, fewer choices.

## 3. Queue editing

- Queue item click → expands editor: slide preview strip + per-slide inputs
  (heading, body, cta) + caption textarea. Live preview updates as you type
  (same slideCard cards).
- Actions on a `queued` post: **Save edits**, **Skip**.
  - Save: PATCH-style action, server validates and stores.
  - Skip: sets status `skipped`. No credit refund (credit was consumed at
    plan time); the next topup run backfills a fresh post for a future day.
    Confirmation inline ("Skip this post? A new one will be generated for a
    future day.").
- Only `status = 'queued'` posts are editable/skippable. Publishing,
  submitted, posted, failed, blocked are locked (read-only display).
- No approval gate anywhere.

## 4. Backend

No new serverless functions (Hobby 12-function limit). Everything through
existing `api/social.js`:

- `GET /api/social?resource=autopilot` → one payload: `{ enabled, postSlot,
  slots: [...allowed], connected, linked, health, queue, posts }` (posts =
  future queued with full slides for editing).
- `POST /api/social` actions (all auth'd, pro-gated where sensible):
  - `toggle` `{ enabled: bool }` → sets `users.autopilot_enabled`.
  - `set-slot` `{ slot: 'HH:MM' }` → validates against allowed list, sets
    `users.post_slot`.
  - `edit-post` `{ postId, slides, caption }` → owner check, status must be
    `queued`, validates slide shape (array 1..10, headings ≤ 120 chars,
    body ≤ 500, cta ≤ 120, caption ≤ 2200), strips control chars; stores.
  - `skip-post` `{ postId }` → owner check, status `queued` → `skipped`.

Schema (migration script `scripts/migrate-autopilot-controls.sql`):

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS autopilot_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS post_slot TEXT NOT NULL DEFAULT '20:30';
```

Worker changes:
- `getAutopilotUsers` adds `AND autopilot_enabled`.
- `publishDue`: posts whose owner has `autopilot_enabled = false` are set
  back to `queued` with a friendly note and counted `held` (join user flag
  into `claimDuePosts` or check per-post). Queue preserved for re-enable.
- Topup passes `user.post_slot` into `nextSlots`.

## 5. Testing

- Unit (node test, existing patterns): `nextSlots` with custom slot values
  and DST-free UTC math; `edit-post` validation (shape, lengths, ownership,
  status lock); toggle gating (disabled user excluded from topup, publish
  holds their due posts); `set-slot` rejects non-allowlisted values.
- Existing suites must stay green: schedule.test.mjs,
  autopilot-reliability.test.mjs, gating.test.mjs.
- Manual on live account: toggle off → verify topup skips + publish holds;
  edit tomorrow's post → verify edited text publishes at 6 AM.

## Out of scope

- Approval gating / approve-before-post email flow (explicitly rejected for
  this build; possible later as separate opt-in).
- Free-form posting times (Hobby cron constraint).
- Regenerate-single-post button (later polish).
- Multi-app per account.
