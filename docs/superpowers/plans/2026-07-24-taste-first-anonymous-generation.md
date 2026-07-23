# Taste-First Anonymous Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let a logged-out visitor generate one full watermarked post for their own product, then claim it on signup, guarded by a 1-ever-per-IP + 75/day-global throttle.

**Architecture:** New `_anon.js` helper holds pure logic (IP hash, throttle decision, cookie helpers). New DB functions in `_db.js` manage an `anon_slots` table + nullable `anon_id` on `carousels`. Existing `/api/profile` and `/api/carousel` gain a session-OR-anon actor resolver; `api/auth/callback` claims the anon post onto the new user. Frontend (`index.html`, `create.html`) drops the hard auth wall and gates at download instead.

**Tech Stack:** Vercel serverless (Node ESM), Neon Postgres (`@neondatabase/serverless`), `node:test`, `@napi-rs/canvas`.

## Global Constraints

- Anon features are DISABLED unless `ANON_IP_SALT` is set. When unset, every anon path is a no-op and current behavior is identical. (User sets this secret himself.)
- `ANON_DAILY_CAP` env, default `75`.
- Per-IP limit: 1 completed anon post EVER (no rolling window).
- Anon carousels are ALWAYS `watermark = true`.
- Client IP from Vercel's trusted `x-real-ip` header only; never raw `x-forwarded-for`.
- Commit to `main` locally; user pushes via GitHub Desktop. Never generate secrets.
- Tests run: `node --test tests/<file>.test.mjs`. Test style = `node:test` + `node:assert`, pure-function unit tests plus source-presence regex checks (see `tests/gating.test.mjs`).
- DB schema changes use lazy `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... IF NOT EXISTS` guards (pattern: `ensureReelSchema` in `_db.js`), tolerant of missing columns (pattern: `missingColumn` in `_db.js`).
- `_`-prefixed api files are helpers, not routes.

---

### Task 1: Pure anon helper — IP hash, throttle decision, cookie

**Files:**
- Create: `api/_anon.js`
- Test: `tests/anon.test.mjs`

**Interfaces:**
- Produces:
  - `anonEnabled()` → boolean (`!!process.env.ANON_IP_SALT`)
  - `anonDailyCap()` → number (parseInt env or 75)
  - `hashIp(ip)` → string (sha256 hex of salt+ip) or `''` when no salt/ip
  - `clientIp(req)` → string from `x-real-ip`
  - `evaluateAnonThrottle({ enabled, ipHasComplete, dailyComplete, cap })` → `{ allowed: bool, reason: 'disabled'|'ip-used'|'daily-cap'|null }`
  - `parseAnonId(req)` → string|null (reads `tg_anon` cookie, must be 64 hex)
  - `newAnonToken()` → 64-hex string
  - `setAnonCookie(res, token)` / `clearAnonCookie(res)` (HttpOnly; Secure; SameSite=Lax; 30d)
  - `appendCookie(res, cookieStr)` — helper that preserves existing Set-Cookie values

- [ ] **Step 1: Write failing tests**

```js
import test from 'node:test';
import assert from 'node:assert';
import { evaluateAnonThrottle, hashIp, clientIp, parseAnonId } from '../api/_anon.js';

test('throttle disabled', () => {
  assert.deepEqual(evaluateAnonThrottle({ enabled: false, ipHasComplete: false, dailyComplete: 0, cap: 75 }),
    { allowed: false, reason: 'disabled' });
});
test('throttle ip already used', () => {
  assert.deepEqual(evaluateAnonThrottle({ enabled: true, ipHasComplete: true, dailyComplete: 0, cap: 75 }),
    { allowed: false, reason: 'ip-used' });
});
test('throttle daily cap hit', () => {
  assert.deepEqual(evaluateAnonThrottle({ enabled: true, ipHasComplete: false, dailyComplete: 75, cap: 75 }),
    { allowed: false, reason: 'daily-cap' });
});
test('throttle allows fresh ip under cap', () => {
  assert.deepEqual(evaluateAnonThrottle({ enabled: true, ipHasComplete: false, dailyComplete: 10, cap: 75 }),
    { allowed: true, reason: null });
});
test('hashIp deterministic + salted', () => {
  process.env.ANON_IP_SALT = 'testsalt';
  const a = hashIp('1.2.3.4'); const b = hashIp('1.2.3.4');
  assert.equal(a, b); assert.equal(a.length, 64); assert.notEqual(a, hashIp('1.2.3.5'));
});
test('hashIp empty without ip', () => {
  process.env.ANON_IP_SALT = 'testsalt';
  assert.equal(hashIp(''), '');
});
test('clientIp reads x-real-ip', () => {
  assert.equal(clientIp({ headers: { 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1' } }), '9.9.9.9');
});
test('parseAnonId requires 64 hex', () => {
  assert.equal(parseAnonId({ headers: { cookie: 'tg_anon=' + 'a'.repeat(64) } }), 'a'.repeat(64));
  assert.equal(parseAnonId({ headers: { cookie: 'tg_anon=short' } }), null);
  assert.equal(parseAnonId({ headers: {} }), null);
});
```

- [ ] **Step 2: Run — expect FAIL** (`node --test tests/anon.test.mjs`; "Cannot find module ../api/_anon.js")

- [ ] **Step 3: Implement `api/_anon.js`**

```js
// api/_anon.js — pure helpers for anonymous taste-first generation.
import crypto from 'crypto';

export function anonEnabled() { return !!process.env.ANON_IP_SALT; }
export function anonDailyCap() {
  const n = parseInt(process.env.ANON_DAILY_CAP, 10);
  return Number.isFinite(n) && n > 0 ? n : 75;
}

export function clientIp(req) {
  const v = req.headers['x-real-ip'];
  return (Array.isArray(v) ? v[0] : v || '').trim();
}

export function hashIp(ip) {
  const salt = process.env.ANON_IP_SALT || '';
  if (!salt || !ip) return '';
  return crypto.createHash('sha256').update(salt + '|' + ip).digest('hex');
}

export function evaluateAnonThrottle({ enabled, ipHasComplete, dailyComplete, cap }) {
  if (!enabled) return { allowed: false, reason: 'disabled' };
  if (ipHasComplete) return { allowed: false, reason: 'ip-used' };
  if (dailyComplete >= cap) return { allowed: false, reason: 'daily-cap' };
  return { allowed: true, reason: null };
}

function parseCookies(req) {
  const out = {}; const header = req.headers.cookie || '';
  header.split(';').forEach((p) => {
    const i = p.indexOf('='); if (i < 0) return;
    out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

export function parseAnonId(req) {
  const t = parseCookies(req).tg_anon;
  return t && /^[0-9a-f]{64}$/.test(t) ? t : null;
}

export function newAnonToken() { return crypto.randomBytes(32).toString('hex'); }

export function appendCookie(res, cookieStr) {
  const prev = res.getHeader('Set-Cookie');
  const list = prev ? (Array.isArray(prev) ? prev.slice() : [prev]) : [];
  list.push(cookieStr);
  res.setHeader('Set-Cookie', list);
}

export function setAnonCookie(res, token) {
  appendCookie(res, `tg_anon=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
}
export function clearAnonCookie(res) {
  appendCookie(res, 'tg_anon=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
}
```

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit** (`git add api/_anon.js tests/anon.test.mjs && git commit`)

---

### Task 2: DB layer — anon_slots schema + slot lifecycle

**Files:**
- Modify: `api/_db.js` (append an "ANON SLOTS" section)
- Test: `tests/anon-db.test.mjs` (source-presence checks; no live DB in CI)

**Interfaces:**
- Produces (all in `_db.js`):
  - `ensureAnonSchema()` — lazy `CREATE TABLE IF NOT EXISTS anon_slots (...)`; `ALTER TABLE carousels ADD COLUMN IF NOT EXISTS anon_id TEXT`; `ALTER TABLE carousels ALTER COLUMN user_id DROP NOT NULL`. Wrapped so repeated calls are cheap; swallow "already exists".
  - `reserveAnonSlot({ anonId, ipHash, cap })` → `{ allowed, reason, slotId }`. Runs: count completed slots for `ipHash`; count today's completed; call `evaluateAnonThrottle`; if allowed INSERT a `reserved` row RETURNING id.
  - `attachAnonProfile(anonId, profileObj)` — UPSERT the reserved slot's `profile` for this anonId (latest reserved slot).
  - `getAnonProfile(anonId)` → profileObj|null
  - `completeAnonSlot({ anonId, carouselId })` — set latest reserved slot `status='complete', carousel_id=...`.
  - `releaseAnonSlot(anonId)` — set latest reserved slot `status='released'`.
  - `claimAnonForUser({ anonId, userId })` — transaction: find `complete` unclaimed slot for anonId; move its carousel to userId (set `user_id`, null `anon_id`); if user's `profile` is null adopt slot profile; `free_carousels_used = free_carousels_used + 1` (capped at limit); mark slot `claimed_by=userId`. Idempotent no-op if none. Returns `{ claimed: bool, carouselId }`.

- [ ] **Step 1: Write failing source-presence test**

```js
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../api/_db.js', import.meta.url), 'utf8');

test('anon db functions exported', () => {
  for (const fn of ['ensureAnonSchema','reserveAnonSlot','attachAnonProfile','getAnonProfile','completeAnonSlot','releaseAnonSlot','claimAnonForUser']) {
    assert.match(src, new RegExp('export async function ' + fn), fn + ' missing');
  }
});
test('anon schema is lazy + nullable user_id', () => {
  assert.match(src, /CREATE TABLE IF NOT EXISTS anon_slots/);
  assert.match(src, /ADD COLUMN IF NOT EXISTS anon_id/);
  assert.match(src, /user_id DROP NOT NULL/);
});
test('reserve uses evaluateAnonThrottle', () => {
  assert.match(src, /evaluateAnonThrottle/);
});
test('claim bumps free usage and clears anon_id', () => {
  const claim = src.match(/export async function claimAnonForUser[\s\S]*?\n}/)?.[0] || '';
  assert.match(claim, /free_carousels_used/);
  assert.match(claim, /anon_id = NULL|anon_id=NULL/);
});
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement** the seven functions in `_db.js` per the interfaces, importing `evaluateAnonThrottle, anonDailyCap` from `./_anon.js`. Use `getSQL()` and the existing `sql` tagged-template style. `ensureAnonSchema` mirrors `ensureReelSchema`'s try/catch-swallow shape. Schema:
```sql
CREATE TABLE IF NOT EXISTS anon_slots (
  id SERIAL PRIMARY KEY,
  anon_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved',
  profile JSONB,
  carousel_id INT,
  claimed_by INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS anon_slots_ip ON anon_slots (ip_hash);
CREATE INDEX IF NOT EXISTS anon_slots_anon ON anon_slots (anon_id);
```
`claimAnonForUser` runs its steps as sequential awaited statements guarded by a `complete AND claimed_by IS NULL` lookup (Neon http has no interactive tx; use a single CTE `UPDATE ... WHERE id = (SELECT ...)` chain, carousel move first, then slot mark).
- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

---

### Task 3: Actor resolver — session OR anon

**Files:**
- Modify: `api/_anon.js` (add `resolveActor`) — but keep DB calls injected to stay testable
- Test: `tests/anon.test.mjs` (extend)

**Interfaces:**
- Produces: `resolveActor(req, res, { getSession, reserveAnonSlot, ensureAnonSchema })` →
  `{ kind:'user', user }` | `{ kind:'anon', anonId, slotReserved:bool } | { kind:'none', reason }`.
  - If `getSession` returns a user → `{kind:'user'}`.
  - Else if `!anonEnabled()` → `{kind:'none', reason:'disabled'}`.
  - Else mint/read anon id, set cookie if new. (Slot reservation happens in the route at import-start, not here — this only identifies.)
  Keep it thin: identity only. Reservation stays in the route so only the import action reserves.

- [ ] **Step 1: Test** — mock getSession returning user → kind user; returning null with salt set → kind anon with 64-hex anonId; salt unset → kind none.
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement** `resolveActor` (identity only, no DB reservation).
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit**

---

### Task 4: `/api/profile` accepts anon import + save

**Files:**
- Modify: `api/profile.js`
- Test: `tests/anon-routes.test.mjs` (source-presence)

**Behavior:**
- On import/save when there is no session but anon is enabled: reserve the slot (`reserveAnonSlot`) at the START of import — if `!allowed`, respond `403 {error:'gate', reason}` so the frontend shows the sign-in gate. If allowed, run the existing import/profile logic but persist the resulting profile via `attachAnonProfile(anonId, profile)` instead of `saveProfile(userId, ...)`.
- `GET /api/profile` with anon → return `{ profile: getAnonProfile(anonId) }`.
- Zero change when a session exists.

- [ ] **Step 1:** source-presence test: `profile.js` imports from `_anon.js`, references `reserveAnonSlot`, `attachAnonProfile`, `getAnonProfile`, and returns a `'gate'` error path.
- [ ] **Step 2:** Run — FAIL
- [ ] **Step 3:** Implement. Add `import { anonEnabled, parseAnonId, clientIp, hashIp, newAnonToken, setAnonCookie, anonDailyCap } from './_anon.js';` and branch after the `getSession` result. Preserve all existing authed logic untouched.
- [ ] **Step 4:** Run — PASS
- [ ] **Step 5:** Commit

---

### Task 5: `/api/carousel` accepts anon plan/background/hero + complete

**Files:**
- Modify: `api/carousel.js`
- Test: `tests/anon-routes.test.mjs` (extend)

**Behavior:**
- `plan`, `background`, `hero`, `GET` accept an anon actor. Anon reads profile via `getAnonProfile(anonId)`; writes carousel via `saveCarousel` with `anonId` (extend `saveCarousel` signature to take an optional `{ anonId }` → INSERT with `user_id NULL, anon_id`). Anon carousels forced `watermark = true`.
- After a successful anon `plan` (carousel row created), call `completeAnonSlot({ anonId, carouselId })` — this is the moment the IP's single taste is consumed.
- Anon may only touch a carousel whose `anon_id` matches their cookie (ownership check in `getCarousel`-equivalent path).
- `GET /api/carousel` for anon → the single anon carousel (history of one).

- [ ] **Step 1:** source-presence test: `carousel.js` references `getAnonProfile`, `completeAnonSlot`, and forces watermark true on the anon branch.
- [ ] **Step 2:** Run — FAIL
- [ ] **Step 3:** Implement. Extend `saveCarousel(userId, hookId, style, slides, caption, watermark, heroScene, anonId)` (append optional param; authed calls unaffected). Add anon ownership lookups.
- [ ] **Step 4:** Run — PASS
- [ ] **Step 5:** Commit

---

### Task 6: Claim-on-signup in OAuth callback

**Files:**
- Modify: `api/auth/callback.js`
- Test: `tests/anon-routes.test.mjs` (extend, source-presence)

**Behavior:** After the user + session are created, read `parseAnonId(req)`; if present call `claimAnonForUser({ anonId, userId })`; clear the anon cookie. Wrap in try/catch so a claim failure never blocks login.

- [ ] **Step 1:** source-presence test: `callback.js` references `claimAnonForUser` and `clearAnonCookie`, inside a try/catch.
- [ ] **Step 2:** Run — FAIL
- [ ] **Step 3:** Implement (read callback.js first; insert claim after `createSession`, before the redirect).
- [ ] **Step 4:** Run — PASS
- [ ] **Step 5:** Commit

---

### Task 7: Frontend — drop the wall, gate at download

**Files:**
- Modify: `create.html`
- Modify: `index.html`

**Behavior:**
- `create.html` auth-gate block: when no user AND anon is available, show the studio (not the gate). Anon can import once + generate once. Download / "make another" / second generate → sign-in prompt CTA ("Sign in free to download this post and make 2 more" → `/api/auth/google`). A `403 {error:'gate'}` from either API swaps in the classic gate.
- `index.html` hero paste: stash URL, navigate to `/create` (no forced `/api/auth/google`).
- Detect anon vs user from `TGUser.ready` as today; anon = the "no user" branch now renders the studio instead of the gate.

- [ ] **Step 1:** Implement create.html JS changes (gate → studio for anon; download/second-action → sign-in CTA; handle 403 gate).
- [ ] **Step 2:** Implement index.html hero-paste redirect change.
- [ ] **Step 3:** Manual smoke via existing UI test harness pattern if feasible; else source-review. Commit.

---

### Task 8: Create-page output-first copy/layout redesign

**Files:**
- Modify: `create.html` (markup + copy + CSS)

**Behavior (intent from spec §6):** Lead with action/output; stop pre-selling what the user is about to see. For a first-run anon visitor the visible path is paste → generating → real post. Demote `deck-preview`, `deliverables`, proof chatter, and the two-panel explainer to secondary/after-output positions. Keep manual entry, hook/style customize, edit, history — demoted, not deleted. Use `interface-design` / `frontend-design` skills for the actual layout & copy.

- [ ] **Step 1:** Invoke frontend-design (or interface-design) skill for direction.
- [ ] **Step 2:** Apply markup/copy/CSS changes.
- [ ] **Step 3:** Verify no regression for logged-in returning users (studio still complete). Commit.

---

### Task 9: Verification pass + handoff note

- [ ] Run full suite: `node --test tests/*.test.mjs` — all green (or explain any pre-existing failures).
- [ ] Write `docs/superpowers/plans/2026-07-24-taste-first-HANDOFF.md`: what was built, what is UNVERIFIED (needs `ANON_IP_SALT` set + a live DB + a real OAuth round-trip), the exact env vars to set, and the manual test script for the morning. Commit.

## Self-Review

- Spec §1 anon identity → Task 1 (cookie) + Task 3. ✓
- Spec §2 throttle (per-IP 1-ever, daily 75, reserve at import) → Task 1 (eval) + Task 2 (reserve) + Task 4 (reserve at import-start). ✓
- Spec §3 session-optional pipeline → Task 3,4,5. ✓
- Spec §4 claim-on-signup → Task 6 + Task 2 (`claimAnonForUser`). ✓
- Spec §5 frontend flow → Task 7. ✓
- Spec §6 create-page redesign → Task 8. ✓
- Schema (anon_id on carousels, anon_slots, nullable user_id) → Task 2. ✓
- Env gating on ANON_IP_SALT → Global Constraints + Task 1 `anonEnabled`, enforced in Task 3/4. ✓
- Watermark forced → Task 5. ✓
- Names consistent: `reserveAnonSlot`, `completeAnonSlot`, `releaseAnonSlot`, `attachAnonProfile`, `getAnonProfile`, `claimAnonForUser`, `evaluateAnonThrottle`, `resolveActor` used identically across tasks. ✓
