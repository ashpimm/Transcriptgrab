# Autopilot Pivot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Hooklab into "your app's faceless TikTok + Instagram on autopilot": content generated in the app's *audience* niche as one narrative arc, queued on a calendar, auto-posted daily via upload-post.com.

**Architecture:** Vanilla HTML/JS + Vercel serverless (no build system) + Neon Postgres. New pieces: dynamic niches derived from each app's audience, a refactored miner callable from profile-save, a narrative content engine shared by the create page and a new autopilot cron, a shared canvas slide renderer (`slide-render.mjs`) used by both browser and `@napi-rs/canvas` server render, and an upload-post.com API client behind a feature flag.

**Tech Stack:** Node 22 ESM, `@neondatabase/serverless`, `stripe`, `@napi-rs/canvas` (new), Gemini 2.5 flash (text) + flash-image (backgrounds), upload-post.com REST API, `node --test`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-13-autopilot-pivot-design.md`. Read it before starting.
- Vercel Hobby: max 12 serverless functions. Current count 9 (auth/google, auth/callback, auth/me, checkout, webhook, hooks, profile, carousel, mine). This plan adds exactly 2 (`social.js`, `autopilot.js`) → 11. Do NOT add any other file directly under `api/` unless `_`-prefixed (ignored by Vercel).
- Vercel Hobby: max 2 cron jobs, daily granularity. We use 2 (`/api/mine`, `/api/autopilot`).
- `maxDuration = 60` needed on any endpoint that mines or generates images.
- Free tier = 3 carousels ever, watermarked. Autopilot = $19/mo, 30 posts/mo fair-use. Credits pack removed from UI but still honored in gating.
- Watermark text: `made with hooklab` — subtle: 26px, 35% opacity, bottom-right, NO pill background. Never orange `#FF4D00` in customer output.
- NO slide-number chips ("1 / 6") anywhere in rendered slides.
- New env vars: `UPLOAD_POST_API_KEY` (absent = manual mode, all posting code no-ops), `STRIPE_AUTOPILOT_PRICE_ID` (falls back to `STRIPE_PRO_PRICE_ID` if unset).
- Tests: `node --test tests/*.test.mjs` (NOT `tests/` — dir form fails on this repo). Tests must not require env vars or network.
- NEVER round-trip file content through PowerShell `Get-Content`/`Set-Content` (mojibake). Use Edit/Write tools only.
- Commit on branch `hooklab-rebuild`. Conventional commits.
- HTML pages live at repo ROOT (`create.html`, `index.html`, `account.html`), not in `public/`.
- CSP is `script-src 'self' 'unsafe-inline'` — module scripts from same origin are fine; no CDN libs.

---

### Task 1: Migration + gating (free-3, 30/mo, posts table)

**Files:**
- Create: `scripts/migrate-autopilot.sql`
- Modify: `api/_db.js` (gating block, lines ~410-448)
- Modify: `api/auth/me.js:52-65`
- Test: `tests/gating.test.mjs`

**Interfaces:**
- Produces: `canGenerateCarousel(user)` → `{allowed, source?, watermark?, reason?}` unchanged shape; `FREE_CAROUSELS = 3`; `CAROUSELS_PER_MONTH = 30`; `consumeCarousel(user, source)`; new columns `users.free_carousels_used INTEGER`, `users.upload_post_username VARCHAR(100)`, table `posts`.

- [ ] **Step 1: Write migration SQL**

```sql
-- scripts/migrate-autopilot.sql — Autopilot pivot (2026-07-13 spec)
-- Run with: node scripts/run-migration.mjs scripts/migrate-autopilot.sql

-- Free tier: 1 -> 3 carousels ever
ALTER TABLE users ADD COLUMN IF NOT EXISTS free_carousels_used INTEGER DEFAULT 0;
UPDATE users SET free_carousels_used = 1
WHERE free_carousel_used = TRUE AND COALESCE(free_carousels_used, 0) = 0;

-- upload-post.com linked profile name (NULL = not connected)
ALTER TABLE users ADD COLUMN IF NOT EXISTS upload_post_username VARCHAR(100);

-- Content calendar
CREATE TABLE IF NOT EXISTS posts (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'queued',  -- queued|posted|failed|skipped
  kind         VARCHAR(20) NOT NULL DEFAULT 'value',   -- value|showcase
  style        VARCHAR(50) DEFAULT 'bold',
  slides       JSONB NOT NULL,                          -- [{index, heading, body}]
  caption      TEXT DEFAULT '',
  accent       VARCHAR(7) DEFAULT '',
  motifs       JSONB DEFAULT '[]',
  platforms    TEXT[] NOT NULL DEFAULT '{tiktok,instagram}',
  external_ids JSONB,
  error        TEXT DEFAULT '',
  retries      INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_posts_due  ON posts(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, scheduled_at DESC);
```

- [ ] **Step 2: Write failing gating tests**

`tests/gating.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert';
import { canGenerateCarousel, FREE_CAROUSELS, CAROUSELS_PER_MONTH } from '../api/_db.js';

test('constants', () => {
  assert.equal(FREE_CAROUSELS, 3);
  assert.equal(CAROUSELS_PER_MONTH, 30);
});

test('free user gets 3 watermarked carousels', () => {
  for (const used of [0, 1, 2]) {
    const g = canGenerateCarousel({ tier: 'free', free_carousels_used: used, credits: 0 });
    assert.deepEqual(g, { allowed: true, source: 'free', watermark: true });
  }
});

test('free user blocked at 3', () => {
  const g = canGenerateCarousel({ tier: 'free', free_carousels_used: 3, credits: 0 });
  assert.equal(g.allowed, false);
  assert.equal(g.reason, 'upgrade');
});

test('legacy boolean-only user (migrated to 1) still has 2 left', () => {
  const g = canGenerateCarousel({ tier: 'free', free_carousels_used: 1, credits: 0 });
  assert.equal(g.allowed, true);
});

test('pro (autopilot) 30/mo, no watermark', () => {
  assert.deepEqual(
    canGenerateCarousel({ tier: 'pro', carousels_used: 29, credits: 0 }),
    { allowed: true, source: 'pro', watermark: false }
  );
  assert.equal(canGenerateCarousel({ tier: 'pro', carousels_used: 30, credits: 0 }).allowed, false);
});

test('credits consumed after pro quota, before free', () => {
  const g = canGenerateCarousel({ tier: 'free', free_carousels_used: 0, credits: 2 });
  assert.deepEqual(g, { allowed: true, source: 'credit', watermark: false });
});

test('null user blocked', () => {
  assert.equal(canGenerateCarousel(null).allowed, false);
});
```

- [ ] **Step 3: Run tests, verify fail**

Run: `node --test tests/gating.test.mjs`
Expected: FAIL — `FREE_CAROUSELS` not exported, 3-cap assertions fail.

- [ ] **Step 4: Update `api/_db.js` gating block**

Replace the existing `CAROUSELS_PER_MONTH`/`canGenerateCarousel`/`consumeCarousel` block (currently lines 413-443) with:

```js
export const CAROUSELS_PER_MONTH = 30;
export const FREE_CAROUSELS = 3;

// Consumption order: Autopilot monthly quota -> legacy purchased credits ->
// the 3 free watermarked carousels. Returns which bucket pays.
export function canGenerateCarousel(user) {
  if (!user) return { allowed: false, reason: 'auth_required' };
  if (user.tier === 'pro' && (user.carousels_used || 0) < CAROUSELS_PER_MONTH) {
    return { allowed: true, source: 'pro', watermark: false };
  }
  if ((user.credits || 0) > 0) {
    return { allowed: true, source: 'credit', watermark: false };
  }
  if (user.tier === 'pro') {
    return { allowed: false, reason: 'monthly_limit' };
  }
  if ((user.free_carousels_used || 0) < FREE_CAROUSELS) {
    return { allowed: true, source: 'free', watermark: true };
  }
  return { allowed: false, reason: 'upgrade' };
}

export async function consumeCarousel(user, source) {
  const sql = getSQL();
  if (source === 'credit') {
    await sql`UPDATE users SET credits = GREATEST(COALESCE(credits, 0) - 1, 0), updated_at = NOW() WHERE id = ${user.id}`;
  } else if (source === 'free') {
    await sql`UPDATE users SET free_carousels_used = COALESCE(free_carousels_used, 0) + 1, free_carousel_used = TRUE, updated_at = NOW() WHERE id = ${user.id}`;
  } else {
    await sql`UPDATE users SET carousels_used = carousels_used + 1, updated_at = NOW() WHERE id = ${user.id}`;
  }
}
```

- [ ] **Step 5: Update `api/auth/me.js` user payload**

In the GET response object (lines 53-64), change/add:

```js
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
        tier: user.tier,
        credits: user.credits || 0,
        carouselsUsed: user.carousels_used || 0,
        carouselsLimit: user.tier === 'pro' ? 30 : 0,
        freeCarouselsUsed: user.free_carousels_used || 0,
        freeCarouselsLimit: 3,
        freeCarouselUsed: !!user.free_carousel_used, // legacy, kept for cached clients
        socialConnected: !!user.upload_post_username,
        profileComplete: !!(user.profile && user.profile.what),
      },
```

- [ ] **Step 6: Run tests, verify pass**

Run: `node --test tests/gating.test.mjs` → all PASS.
Also run: `node --test tests/*.test.mjs` → existing scoring tests still PASS.

- [ ] **Step 7: Run the migration against Neon**

Run: `node scripts/run-migration.mjs scripts/migrate-autopilot.sql` (check `run-migration.mjs` usage first — if it hardcodes a file, follow its pattern). Verify: it exits 0. If `POSTGRES_URL` is not available locally, mark this step as USER ACTION in the final report — everything else proceeds.

- [ ] **Step 8: Commit**

```bash
git add scripts/migrate-autopilot.sql api/_db.js api/auth/me.js tests/gating.test.mjs
git commit -m "feat: free-3 gating, 30/mo autopilot quota, posts table migration"
```

---

### Task 2: Audience-niche derivation (profile → dynamic niche)

**Files:**
- Modify: `api/_prompts.js` (APP_PROFILE_PROMPT + new AUDIENCE_NICHE_PROMPT)
- Modify: `api/_db.js` (add `slugifyNiche`, `ensureNiche`, `getCuratedHookPool`)
- Modify: `api/profile.js` (cleanProfile + save + import)
- Test: `tests/niche.test.mjs`

**Interfaces:**
- Produces: `slugifyNiche(name: string) → string` (pure, exported from `api/_db.js`); `ensureNiche({slug, name, keywords}) → niche row`; `getCuratedHookPool(poolSize=12) → hook rows (curated, any niche)`; profile JSON gains `audience_niche: { slug, name }`.
- Consumes: `callGemini(prompt, text, temp)` from `api/_shared.js`.

- [ ] **Step 1: Write failing slugify tests**

`tests/niche.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert';
import { slugifyNiche } from '../api/_db.js';

test('lowercase kebab', () => {
  assert.equal(slugifyNiche('Fitness & Weight Loss'), 'fitness-weight-loss');
});

test('collapses runs, trims edge dashes', () => {
  assert.equal(slugifyNiche('  Home -- Cooking!! '), 'home-cooking');
});

test('caps at 50 chars without trailing dash', () => {
  const s = slugifyNiche('a'.repeat(45) + ' bcdefgh');
  assert.ok(s.length <= 50);
  assert.ok(!s.endsWith('-'));
});

test('empty/garbage input -> empty string', () => {
  assert.equal(slugifyNiche('!!!'), '');
  assert.equal(slugifyNiche(''), '');
  assert.equal(slugifyNiche(null), '');
});
```

- [ ] **Step 2: Run, verify fail** — `node --test tests/niche.test.mjs` → FAIL (`slugifyNiche` not exported).

- [ ] **Step 3: Add helpers to `api/_db.js`** (append in the NICHES & HOOKS section, after `markNicheMined`)

```js
export function slugifyNiche(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50)
    .replace(/-+$/, '');
}

// Insert-or-fetch a niche row. DO UPDATE (no-op) instead of DO NOTHING so the
// RETURNING row always comes back on conflict.
export async function ensureNiche({ slug, name, keywords }) {
  const sql = getSQL();
  const rows = await sql`
    INSERT INTO niches (slug, name, keywords)
    VALUES (${slug}, ${name}, ${keywords || []})
    ON CONFLICT (slug) DO UPDATE SET name = niches.name
    RETURNING *
  `;
  return rows[0];
}

// Cross-niche curated patterns — cold-start pool for freshly created niches
// that haven't been mined yet. Curated rows are portable format patterns.
export async function getCuratedHookPool(poolSize = 12) {
  const sql = getSQL();
  return sql`
    SELECT h.*, n.slug AS niche_slug
    FROM hooks h JOIN niches n ON n.id = h.niche_id
    WHERE h.curated = TRUE
    ORDER BY random()
    LIMIT ${poolSize}
  `;
}
```

- [ ] **Step 4: Run tests, verify pass** — `node --test tests/niche.test.mjs` → PASS.

- [ ] **Step 5: Add AUDIENCE_NICHE_PROMPT + extend APP_PROFILE_PROMPT in `api/_prompts.js`**

Append:

```js
// ============================================
// AUDIENCE NICHE (app profile -> its BUYERS' content niche)
// ============================================
export const AUDIENCE_NICHE_PROMPT = `You receive JSON { name, what, who, benefit } describing an app. Identify the content niche of the app's TARGET USERS — the people who would download and use it — NOT the app-developer/indie-hacker/build-in-public niche, unless the app's users literally are software developers.

Example: an AI calorie-counting app -> its users are people trying to lose weight or eat better -> niche is "Fitness & Weight Loss", NOT "App Development".

Return ONLY this JSON object:
{
  "name": "Fitness & Weight Loss",
  "keywords": ["calorie deficit tips", "how to lose weight fast", "what I eat in a day", "macro tracking for beginners", "weight loss mistakes"]
}

Rules:
- name: 2-4 words, Title Case, the audience's content niche.
- keywords: 4-6 YouTube Shorts search phrases this audience actually types or watches — their language, not marketing jargon. Lowercase.
- Output raw JSON only. No markdown fences.`;
```

In `APP_PROFILE_PROMPT`, extend the JSON template object with one more field after `"color"`:

```
  "audience_niche": { "name": "Fitness & Weight Loss", "keywords": ["4-6 YouTube Shorts search phrases the app's TARGET USERS watch"] }
```

and append one rule line:

```
- audience_niche: the content niche of the app's TARGET USERS (the people who would use it), never "app development" unless the users are developers. keywords are lowercase search phrases in the audience's own language.
```

- [ ] **Step 6: Wire into `api/profile.js`**

(a) `cleanProfile` gains the field — add before the closing `};`:

```js
    audience_niche: (p.audience_niche && typeof p.audience_niche === 'object' && p.audience_niche.slug && p.audience_niche.name)
      ? { slug: clipText(String(p.audience_niche.slug), 50), name: clipText(String(p.audience_niche.name), 100) }
      : null,
```

(b) Imports: `import { getSession, getProfile, saveProfile, slugifyNiche, ensureNiche } from './_db.js';` and `import { APP_PROFILE_PROMPT, PICK_COLOR_PROMPT, AUDIENCE_NICHE_PROMPT } from './_prompts.js';`

(c) In the `save` action, after the color-pick block and before `saveProfile`, insert:

```js
    // Every profile gets an audience niche: it decides which niche gets mined
    // and which hook pool feeds generation. Derived once, user-visible later.
    if (!cleaned.audience_niche) {
      try {
        const derived = await callGemini(AUDIENCE_NICHE_PROMPT, JSON.stringify({
          name: cleaned.name, what: cleaned.what, who: cleaned.who, benefit: cleaned.benefit,
        }), 0.3);
        const slug = slugifyNiche(derived?.name);
        if (slug) {
          const keywords = (Array.isArray(derived.keywords) ? derived.keywords : [])
            .map((k) => clipText(String(k), 80)).filter(Boolean).slice(0, 6);
          await ensureNiche({ slug, name: clipText(derived.name, 100), keywords });
          cleaned.audience_niche = { slug, name: clipText(derived.name, 100) };
        }
      } catch (e) {
        console.error('audience niche derivation failed:', e.message);
      }
    } else {
      // User-confirmed niche may be brand new — make sure the row exists.
      await ensureNiche({ slug: cleaned.audience_niche.slug, name: cleaned.audience_niche.name, keywords: [] }).catch(() => {});
    }
```

(d) In the `import` action, pass through what the profile prompt extracted — in the `cleanProfile({...})` call add:

```js
        audience_niche: structured.audience_niche && structured.audience_niche.name
          ? { slug: slugifyNiche(structured.audience_niche.name), name: structured.audience_niche.name }
          : null,
```

(Note: `import` does not save — `ensureNiche` for imported niches happens at save time via branch (c).)

- [ ] **Step 7: Verify no syntax errors** — `node --check api/profile.js api/_db.js api/_prompts.js` → no output. Run `node --test tests/*.test.mjs` → PASS.

- [ ] **Step 8: Commit**

```bash
git add api/_prompts.js api/_db.js api/profile.js tests/niche.test.mjs
git commit -m "feat: derive audience niche from app profile, dynamic niche rows"
```

---

### Task 3: Miner refactor — callable core + subscriber-priority rotation

**Files:**
- Create: `api/_miner.js` (extracted from `api/mine.js`)
- Modify: `api/mine.js` (becomes thin handler)
- Modify: `api/_db.js` (`getStalestNiche` subscriber boost)
- Modify: `api/profile.js` (light mine kick on save when pool is thin)

**Interfaces:**
- Produces: `mineNiche(niche, apiKey, opts) → { niche, scanned, outliers, inserted, refreshed, wouldInsert?, errors[] }` where `opts = { maxKeywords=4, maxSeedChannels=3, maxExtractions=10, maxTranscripts=3, dry=false }`. Exported from `api/_miner.js`.
- Consumes: everything `api/mine.js` currently imports.

- [ ] **Step 1: Create `api/_miner.js`**

Move the entire pipeline body of `api/mine.js` (steps 1-8, lines 52-179) into:

```js
// api/_miner.js — Mining pipeline core, callable from the cron endpoint AND
// from profile-save (light mode) for freshly created audience niches.
// Vercel ignores _-prefixed files in api/ as endpoints.

import {
  markNicheMined, getExistingHookUrls, refreshHookStats, upsertHook,
} from './_db.js';
import {
  computeOutlierScore, isOutlier, isMostlyLatin,
  searchShorts, channelRecentShorts, getVideoStats, getChannelStats,
} from './_youtube.js';
import { fetchTranscript } from './_transcript.js';
import { callGemini } from './_shared.js';
import { HOOK_EXTRACTION_PROMPT } from './_prompts.js';

const VALID_FORMATS = ['talking_head', 'whiteboard', 'audio_broll', 'skit', 'other'];

function videoUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export async function mineNiche(niche, apiKey, opts = {}) {
  const {
    maxKeywords = 4, maxSeedChannels = 3,
    maxExtractions = 10, maxTranscripts = 3, dry = false,
  } = opts;
  const errors = [];
  // ... [steps 1-8 from mine.js VERBATIM, with the constants above replacing
  //      MAX_KEYWORDS_PER_RUN etc., and `return res.status(...)` replaced by
  //      plain return objects:]
  //   dry return:   return { dry: true, niche: niche.slug, scanned, outliers: outliers.length, wouldRefresh: refresh.length, wouldInsert: rows, errors }
  //   final return: return { niche: niche.slug, scanned: videoIds.length, outliers: outliers.length, inserted, refreshed: refresh.length, errors }
}
```

The copied body is IDENTICAL logic to current `api/mine.js:52-179` — same candidate gathering, batch stats, outlier filter, existing/fresh split, transcript enrichment (capped by `maxTranscripts`), Gemini extraction, relevance + Latin gates, row building, dry short-circuit, writes, `markNicheMined`. Only the wrapper changes (function args instead of req/res).

- [ ] **Step 2: Shrink `api/mine.js` to a thin handler**

```js
// api/mine.js — Niche research pipeline (cron + admin trigger).
// GET /api/mine?secret=$ADMIN_SECRET[&niche=slug][&dry=1]

import { getNicheBySlug, getStalestNiche } from './_db.js';
import { mineNiche } from './_miner.js';

export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const isCron = !!req.headers['x-vercel-cron'];
  const secretOk = process.env.ADMIN_SECRET && req.query.secret === process.env.ADMIN_SECRET;
  if (!isCron && !secretOk) return res.status(401).json({ error: 'Unauthorized' });

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'YOUTUBE_API_KEY not configured' });

  try {
    const niche = req.query.niche
      ? await getNicheBySlug(req.query.niche)
      : await getStalestNiche();
    if (!niche) return res.status(404).json({ error: 'No active niche found' });

    const result = await mineNiche(niche, apiKey, { dry: req.query.dry === '1' });
    return res.status(200).json(result);
  } catch (e) {
    console.error('mine error:', e);
    return res.status(500).json({ error: e.message });
  }
}
```

- [ ] **Step 3: Subscriber-priority rotation in `api/_db.js`**

Replace `getStalestNiche` body:

```js
export async function getStalestNiche() {
  const sql = getSQL();
  // Niches that belong to a paying subscriber's audience jump the queue when
  // they haven't been mined in 24h; otherwise plain stalest-first rotation.
  const rows = await sql`
    SELECT n.* FROM niches n
    WHERE n.active = TRUE
    ORDER BY (
      (n.last_mined_at IS NULL OR n.last_mined_at < NOW() - INTERVAL '24 hours')
      AND EXISTS (
        SELECT 1 FROM users u
        WHERE u.tier = 'pro' AND u.profile->'audience_niche'->>'slug' = n.slug
      )
    ) DESC,
    n.last_mined_at ASC NULLS FIRST
    LIMIT 1
  `;
  return rows[0] || null;
}
```

- [ ] **Step 4: Light mine on profile save**

`api/profile.js`: add `export const maxDuration = 60;` at top level. Imports gain `getAutoHookPool` (from `./_db.js`) and `mineNiche` (from `./_miner.js`), plus `getNicheBySlug`. In the `save` action, after the audience-niche block (Task 2c) and BEFORE `saveProfile`, insert:

```js
    // Fresh niches have zero mined hooks — kick a light mine inline so the
    // user's first generation isn't stuck on curated fallbacks. Best effort.
    if (cleaned.audience_niche && process.env.YOUTUBE_API_KEY) {
      try {
        const pool = await getAutoHookPool(cleaned.audience_niche.slug, 5);
        if (pool.length < 5) {
          const nicheRow = await getNicheBySlug(cleaned.audience_niche.slug);
          if (nicheRow) {
            await mineNiche(nicheRow, process.env.YOUTUBE_API_KEY, {
              maxKeywords: 2, maxSeedChannels: 0, maxExtractions: 6, maxTranscripts: 0,
            });
          }
        }
      } catch (e) {
        console.error('light mine on save failed:', e.message);
      }
    }
```

- [ ] **Step 5: Verify** — `node --check api/_miner.js api/mine.js api/profile.js api/_db.js` clean; `node --test tests/*.test.mjs` PASS. Manual smoke (needs env): `GET /api/mine?secret=...&niche=appdev&dry=1` still returns scanned/outliers JSON — if no local env, defer to deploy smoke.

- [ ] **Step 6: Commit**

```bash
git add api/_miner.js api/mine.js api/_db.js api/profile.js
git commit -m "feat: extract miner core, subscriber-priority rotation, light mine on profile save"
```

---

### Task 4: Narrative content engine

**Files:**
- Modify: `api/_prompts.js` (rewrite CAROUSEL_COPY_PROMPT)
- Create: `api/_generate.js` (generation core, extracted from `api/carousel.js`)
- Modify: `api/carousel.js` (use the core; audience-niche hook pool)
- Test: `tests/generate.test.mjs`

**Interfaces:**
- Produces: `generateCarouselPlan({ profile, kind='value', hookId=null, styleOverride='' }) → { hook, style, slides[], caption, motifs[], accent }` and `backgroundPrompt(style, profile, motifs, accentOverride)` and `STYLES`, `resolveAccent`, `cleanMotifs`, `validHex` — all exported from `api/_generate.js`. `postKind(n) → 'value'|'showcase'` (pure).
- Consumes: `getAutoHookPool`, `getCuratedHookPool`, `getHooksByIds` from `_db.js`; `callGemini` from `_shared.js`.

- [ ] **Step 1: Write failing test for `postKind` + prompt payload shape**

`tests/generate.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert';
import { postKind, buildPlanPayload } from '../api/_generate.js';

test('postKind: every 4th post is a showcase (75/25 mix)', () => {
  assert.equal(postKind(0), 'value');
  assert.equal(postKind(1), 'value');
  assert.equal(postKind(2), 'value');
  assert.equal(postKind(3), 'showcase');
  assert.equal(postKind(7), 'showcase');
  assert.equal(postKind(8), 'value');
});

test('buildPlanPayload carries audience niche + kind', () => {
  const p = buildPlanPayload({
    profile: { name: 'CalSnap', what: 'AI calorie counter', who: 'people losing weight', benefit: 'log meals from a photo', tone: 'casual', audience_niche: { slug: 'fitness-weight-loss', name: 'Fitness & Weight Loss' } },
    hook: { hook_template: '5 things I wish I knew before ___', hook_verbatim: '', topic: 'lessons list' },
    kind: 'showcase',
    slideCount: 6,
  });
  assert.equal(p.audienceNiche, 'Fitness & Weight Loss');
  assert.equal(p.kind, 'showcase');
  assert.equal(p.slideCount, 6);
  assert.equal(p.app.name, 'CalSnap');
  assert.equal(p.hook.template, '5 things I wish I knew before ___');
});
```

- [ ] **Step 2: Run, verify fail** — `node --test tests/generate.test.mjs` → FAIL (module missing).

- [ ] **Step 3: Rewrite `CAROUSEL_COPY_PROMPT` in `api/_prompts.js`**

```js
export const CAROUSEL_COPY_PROMPT = `You write faceless slideshow posts (TikTok photo-mode / Instagram carousels) that grow an audience for an app. You receive JSON:
- app: { name, what, who, benefit, tone }
- audienceNiche: the content niche of the app's TARGET USERS (write for THEM, in their language — never for app developers)
- hook: { template, verbatim, topic } — a proven hook PATTERN
- kind: "value" or "showcase"
- slideCount: total slides including hook slide and final slide

Return ONLY this JSON object:
{
  "slides": [
    { "index": 0, "heading": "the adapted hook, max 12 words", "body": "" },
    { "index": 1, "heading": "short punchy heading", "body": "1-2 sentences of concrete value, max 30 words" }
  ],
  "caption": "2-3 sentences continuing the post's idea, ending with where to get the app (app name, not a URL)",
  "hashtags": ["5-8 lowercase hashtags without #, audienceNiche tags + reach tags"],
  "motifs": ["3-5 concrete drawable objects representing the app's subject"]
}

THE ONE RULE THAT MATTERS — a single narrative arc:
Slide 0 makes a promise. Every following slide pays off exactly that promise. The last slide is the natural conclusion of the same arc. A reader must never feel the topic change between slide 0 and the last slide. If slide 0 promises "5 things", the middle slides ARE the 5 things, numbered. The app enters only where the arc naturally lands on the job the app does — as the payoff, never as a bolted-on ad.

kind = "value": a genuinely useful listicle/guide for audienceNiche (tips, mistakes, mini-plan, myths). Real substance the reader can use without the app. The final slide's insight naturally involves the app's job-to-be-done, then names the app once + "link in bio" phrasing in the caption, not on the slide.
kind = "showcase": a problem-story arc — slide 0 names a painful, specific problem app.who has; middle slides walk the pain and what solving it feels like; final slide reveals the app as how, in plain words.

Rules:
- Adapt hook.template's ___ slots with audienceNiche specifics. NEVER paste hook.verbatim; it is another creator's line about a different subject.
- Middle slides each carry ONE concrete idea. Pull facts only from app.what / app.who / app.benefit — never invent numbers, users, or results.
- Headings max 12 words. Bodies max 30 words. Text must fit on an image.
- Match app.tone: casual = contractions and plain talk; professional = tight and direct; funny = one honest joke maximum; authority = confident short declaratives.
- Banned: "here's the truth", "skyrocket", "game-changer", "unlock", "elevate", "delve". No em-dashes, no emoji in slides.
- motifs: physical objects an illustrator could draw for THIS app's subject. Never "app", "screen", "phone", "logo", "text", or abstractions.
- Before answering, verify: does the last slide follow directly from slide 0's promise? Is every middle slide substantive? If not, rewrite, then output.
- Output raw JSON only. No markdown fences.`;
```

- [ ] **Step 4: Create `api/_generate.js`**

Move from `api/carousel.js`: `NEUTRAL_ACCENT`, `validHex`, `resolveAccent`, `cleanMotifs`, `STYLES`, `BG_STYLES`, `backgroundPrompt`, `SLIDE_COUNT` — verbatim. Add:

```js
// api/_generate.js — Carousel generation core, shared by the create page
// endpoint (api/carousel.js) and the autopilot cron (api/autopilot.js).
// Vercel ignores _-prefixed files in api/ as endpoints.

import { getAutoHookPool, getCuratedHookPool, getHooksByIds } from './_db.js';
import { callGemini } from './_shared.js';
import { CAROUSEL_COPY_PROMPT } from './_prompts.js';

// [moved blocks here: SLIDE_COUNT, NEUTRAL_ACCENT, validHex, resolveAccent,
//  cleanMotifs, STYLES, BG_STYLES, backgroundPrompt — all `export`ed]

// 75% value listicles, 25% direct app showcase, deterministic by post count.
export function postKind(n) {
  return n % 4 === 3 ? 'showcase' : 'value';
}

export function buildPlanPayload({ profile, hook, kind, slideCount }) {
  return {
    app: {
      name: profile.name || '',
      what: profile.what,
      who: profile.who || '',
      benefit: profile.benefit || '',
      tone: profile.tone || 'casual',
    },
    audienceNiche: profile.audience_niche?.name || 'General',
    hook: { template: hook.hook_template, verbatim: hook.hook_verbatim || '', topic: hook.topic || '' },
    kind: kind === 'showcase' ? 'showcase' : 'value',
    slideCount,
  };
}

async function pickHook(profile, hookId) {
  if (Number.isInteger(hookId) && hookId > 0) {
    const found = (await getHooksByIds([hookId]))[0];
    if (found) return found;
  }
  const nicheSlug = profile.audience_niche?.slug || 'appdev';
  let pool = await getAutoHookPool(nicheSlug, 10);
  if (pool.length === 0) pool = await getCuratedHookPool(12); // cold niche: portable curated patterns
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

export async function generateCarouselPlan({ profile, kind = 'value', hookId = null, styleOverride = '' }) {
  const hook = await pickHook(profile, hookId);
  if (!hook) throw new Error('No hooks available yet — try again shortly.');

  const styleKeys = Object.keys(STYLES);
  const style = STYLES[styleOverride] ? styleOverride : styleKeys[Math.floor(Math.random() * styleKeys.length)];

  const payload = buildPlanPayload({ profile, hook, kind, slideCount: SLIDE_COUNT });
  const out = await callGemini(CAROUSEL_COPY_PROMPT, JSON.stringify(payload), 0.7);
  if (!out || !Array.isArray(out.slides) || out.slides.length === 0) {
    throw new Error('AI returned an invalid response. Please try again.');
  }

  const slides = out.slides.slice(0, SLIDE_COUNT).map((s, i) => ({
    index: i,
    heading: String(s.heading || '').substring(0, 120),
    body: String(s.body || '').substring(0, 220),
  }));
  const hashtags = (Array.isArray(out.hashtags) ? out.hashtags : [])
    .map((h) => String(h).replace(/^#/, '').replace(/[^a-z0-9_]/gi, '').toLowerCase())
    .filter(Boolean).slice(0, 8);
  let caption = String(out.caption || '').substring(0, 1000);
  if (hashtags.length > 0) caption = caption + '\n\n' + hashtags.map((h) => '#' + h).join(' ');

  return {
    hook, style, slides, caption,
    motifs: cleanMotifs(out.motifs),
    accent: validHex(profile.color),
  };
}
```

- [ ] **Step 5: Rewire `api/carousel.js`**

- Delete the moved blocks (`NEUTRAL_ACCENT`…`backgroundPrompt`, `SLIDE_COUNT`, `slidePrompt` STAYS for legacy 'slide' action — it references `STYLES`, so import it).
- Imports become:

```js
import {
  getSession, getProfile, saveCarousel, getCarousels, getCarousel,
  canGenerateCarousel, consumeCarousel,
} from './_db.js';
import { callGeminiImage } from './_shared.js';
import { generateCarouselPlan, backgroundPrompt, cleanMotifs, STYLES, resolveAccent } from './_generate.js';
```

- The `plan` action body (after gate + profile checks) becomes:

```js
      let plan;
      try {
        plan = await generateCarouselPlan({
          profile,
          hookId: parseInt(body.hookId, 10),
          styleOverride: body.style || '',
          kind: 'value',
        });
      } catch (e) {
        if (String(e.message).startsWith('No hooks')) {
          return res.status(503).json({ error: e.message });
        }
        throw e;
      }

      const saved = await saveCarousel(user.id, plan.hook.id, plan.style, plan.slides, plan.caption, gate.watermark);
      await consumeCarousel(user, gate.source);

      return res.status(200).json({
        carouselId: saved.id, style: plan.style, slides: plan.slides, caption: plan.caption,
        motifs: plan.motifs, accent: plan.accent,
        watermark: !!gate.watermark, source: gate.source,
      });
```

- Update the 402 message strings: replace the two hardcoded messages with:
  - monthly_limit: `'You have used all 30 posts this month. They reset on your billing date.'`
  - upgrade: `'You have used your 3 free carousels. Autopilot is $19/mo — content posted daily for you.'`

- [ ] **Step 6: Run tests** — `node --test tests/*.test.mjs` → PASS. `node --check api/carousel.js api/_generate.js` clean.

- [ ] **Step 7: Commit**

```bash
git add api/_prompts.js api/_generate.js api/carousel.js tests/generate.test.mjs
git commit -m "feat: narrative-arc content engine, audience-niche hook pool, 75/25 mix"
```

---

### Task 5: Shared slide renderer (no chips, subtle watermark)

**Files:**
- Create: `slide-render.mjs` (repo root, served as a static module)
- Modify: `create.html` (delegate drawSlide + drop applyWatermark; copy tweaks come in Task 9)

**Interfaces:**
- Produces: `slide-render.mjs` exporting `SLIDE_W=1080`, `SLIDE_H=1350`, `SLIDE_THEMES`, `drawSlideOn(canvas, bg, slide, count, style, accent, opts={})` where `opts = { watermark: false, fontSans: 'Geist, sans-serif', fontMono: '"Geist Mono", monospace' }`. Draws in place; caller owns canvas creation and export. Works with both browser `CanvasRenderingContext2D` and `@napi-rs/canvas` contexts (uses ONLY: drawImage, fillRect, fillText, measureText, font, fillStyle, textBaseline, globalAlpha).
- Consumes: nothing (pure module, no imports).

- [ ] **Step 1: Create `slide-render.mjs`**

```js
// slide-render.mjs — THE slide renderer. Shared verbatim by the browser
// (create.html preview/download) and the server (api/_render.js autopilot
// posting) so the two can never drift. 2D-context calls only.

export const SLIDE_W = 1080;
export const SLIDE_H = 1350;

export const SLIDE_THEMES = {
  bold:     { overlay: 'rgba(13,16,20,0.62)',    ink: '#FFFFFF', sub: 'rgba(255,255,255,0.85)', mono: false },
  mono:     { overlay: 'rgba(250,250,247,0.88)', ink: '#141414', sub: 'rgba(20,20,20,0.72)',    mono: false },
  notebook: { overlay: 'rgba(247,242,230,0.82)', ink: '#20232B', sub: 'rgba(32,35,43,0.75)',    mono: false },
  stat:     { overlay: 'rgba(5,6,8,0.68)',       ink: '#F5F5F6', sub: 'rgba(245,245,246,0.72)', mono: true  },
};

function isHex(c) { return /^#[0-9a-fA-F]{6}$/.test(c || ''); }

function wrapText(x, text, maxWidth) {
  var words = String(text || '').split(/\s+/).filter(Boolean);
  var lines = [], line = '';
  words.forEach(function (w) {
    var probe = line ? line + ' ' + w : w;
    if (x.measureText(probe).width > maxWidth && line) { lines.push(line); line = w; }
    else line = probe;
  });
  if (line) lines.push(line);
  return lines;
}

export function drawSlideOn(canvas, bg, slide, count, style, accent, opts) {
  opts = opts || {};
  var theme = SLIDE_THEMES[style] || SLIDE_THEMES.bold;
  var fontSans = opts.fontSans || 'Geist, sans-serif';
  var fontMono = opts.fontMono || '"Geist Mono", monospace';
  var family = theme.mono ? fontMono : fontSans;
  var x = canvas.getContext('2d');

  // cover-fit background (naturalWidth in browsers, width on server images)
  var iw = bg.naturalWidth || bg.width, ih = bg.naturalHeight || bg.height;
  var scale = Math.max(SLIDE_W / iw, SLIDE_H / ih);
  x.drawImage(bg, (SLIDE_W - iw * scale) / 2, (SLIDE_H - ih * scale) / 2, iw * scale, ih * scale);

  // legibility overlay
  x.fillStyle = theme.overlay;
  x.fillRect(0, 0, SLIDE_W, SLIDE_H);

  var pad = 100, maxW = SLIDE_W - pad * 2;

  // heading — shrink until it fits 6 lines
  var hSize = 92, hLines;
  do {
    x.font = '800 ' + hSize + 'px ' + family;
    hLines = wrapText(x, slide.heading, maxW);
    if (hLines.length <= 6) break;
    hSize -= 8;
  } while (hSize > 48);
  var hLH = Math.round(hSize * 1.12);

  var bSize = 40, bLH = Math.round(bSize * 1.42), bLines = [];
  if (slide.body) {
    x.font = '500 ' + bSize + 'px ' + family;
    bLines = wrapText(x, slide.body, maxW);
  }

  var gap = slide.body ? 44 : 0;
  var blockH = hLines.length * hLH + gap + bLines.length * bLH;
  var top = Math.max(pad + 120, (SLIDE_H - blockH) / 2);

  // accent bar above the heading — the USER'S brand color, never Hooklab orange
  x.fillStyle = isHex(accent) ? accent : theme.ink;
  x.fillRect(pad, top - 56, 88, 12);

  x.textBaseline = 'top';
  x.fillStyle = theme.ink;
  x.font = '800 ' + hSize + 'px ' + family;
  hLines.forEach(function (ln, i) { x.fillText(ln, pad, top + i * hLH); });

  if (bLines.length) {
    x.fillStyle = theme.sub;
    x.font = '500 ' + bSize + 'px ' + family;
    var bTop = top + hLines.length * hLH + gap;
    bLines.forEach(function (ln, i) { x.fillText(ln, pad, bTop + i * bLH); });
  }

  // NO slide-index chip — deliberate (2026-07-13 spec).

  // Free-tier watermark: whisper, not a badge. Last slide only (caller decides).
  if (opts.watermark) {
    var wm = 'made with hooklab';
    x.globalAlpha = 0.35;
    x.fillStyle = theme.ink;
    x.font = '500 26px ' + fontMono;
    x.textBaseline = 'alphabetic';
    x.fillText(wm, SLIDE_W - pad - x.measureText(wm).width, SLIDE_H - 52);
    x.globalAlpha = 1;
  }
}
```

- [ ] **Step 2: Wire into `create.html`**

(a) In `<head>` (or before the main inline script), add:

```html
<script type="module">
  import * as SlideRender from '/slide-render.mjs';
  window.SlideRender = SlideRender;
</script>
```

(b) DELETE from the inline script: `SLIDE_THEMES` object, `wrapText`, the whole `drawSlide` function body, and `applyWatermark`. Keep `SLIDE_W/SLIDE_H` removals too (module owns them). Replace `drawSlide` with:

```js
function drawSlide(bg, slide, count, style, isLast) {
  var R = window.SlideRender;
  if (!R) throw new Error('renderer not loaded');
  var c = document.createElement('canvas');
  c.width = R.SLIDE_W; c.height = R.SLIDE_H;
  var accent = (ST.carousel && ST.carousel.accent) || (ST.profile && ST.profile.color) || '';
  R.drawSlideOn(c, bg, slide, count, style, accent, { watermark: !!(ST.watermark && isLast) });
  return c.toDataURL('image/png');
}
```

(c) In `generateSlides()`, the per-slide loop simplifies (watermark now handled inside drawSlideOn):

```js
          slides.forEach(function (s) {
            var isLast = s.index === slides.length - 1;
            var dataUrl = drawSlide(bg, s, slides.length, style, res.j.watermark && isLast);
```

wait — signature: pass `isLast` and set `ST.watermark = !!res.j.watermark` before the loop (it already is set at plan time; keep using `res.j.watermark && isLast` via the parameter). Final loop body:

```js
          slides.forEach(function (s) {
            var isLast = s.index === slides.length - 1;
            ST.watermark = !!res.j.watermark;
            var dataUrl = drawSlide(bg, s, slides.length, style, isLast);
            SLIDE_IMAGES[s.index] = dataUrl;
            var box = el('slide-' + s.index);
            if (box) box.innerHTML = '<img src="' + dataUrl + '" alt="Slide ' + (s.index + 1) + '">';
            if (--pending === 0) { var d = el('dl-all'); if (d) d.disabled = false; }
          });
```

(the old `finish`/`applyWatermark` callback dance goes away — everything is synchronous now).

- [ ] **Step 3: Verify in browser (headless)**

Serve repo root over local http (`node`-based one-liner or the scratchpad mockserver pattern), open `create.html` with the mock server + `?autogen=1` drive, screenshot a generated slide set. Confirm: (1) no "N / 6" chip bottom-left, (2) watermark on last slide is small, semi-transparent, bottom-right, no pill, (3) headings render in Geist. If mockserver from a previous session isn't in scratchpad, verify at minimum: page loads with zero console errors and `window.SlideRender.drawSlideOn` is a function (evaluate via headless chrome `--dump-dom` on a probe page or manual user check).

- [ ] **Step 4: Commit**

```bash
git add slide-render.mjs create.html
git commit -m "feat: shared slide renderer — no index chips, subtle watermark"
```

---

### Task 6: Server-side render (`@napi-rs/canvas`)

**Files:**
- Create: `api/_render.js`
- Create: `fonts/` (Geist static TTFs, committed)
- Modify: `package.json` (dependency)
- Test: `tests/render.test.mjs`

**Interfaces:**
- Produces: `renderSlidePngs({ slides, style, accent, bgBase64, watermark }) → Promise<Buffer[]>` (one PNG buffer per slide, watermark only on last slide when `watermark` true). Exported from `api/_render.js`.
- Consumes: `drawSlideOn`, `SLIDE_W`, `SLIDE_H` from `../slide-render.mjs`.

- [ ] **Step 1: Install dependency**

Run: `npm install @napi-rs/canvas`
Expected: adds to package.json dependencies, no build step (prebuilt binaries; Vercel linux binary resolves at deploy).

- [ ] **Step 2: Vendor Geist static fonts**

Download Geist + Geist Mono static TTFs (weights 500 Medium and 800 ExtraBold for sans; 500 Medium for mono) from the vercel/geist-font GitHub repo (Releases page asset zip, or `https://github.com/vercel/geist-font` → `packages`/`fonts` dirs). Place as:

```
fonts/Geist-Medium.ttf
fonts/Geist-ExtraBold.ttf
fonts/GeistMono-Medium.ttf
```

If only a variable font TTF is available (`Geist[wght].ttf`), commit that single file for each family instead — `@napi-rs/canvas` registers variable fonts and picks weight from the font string. Verify each file is a real TTF: `file fonts/*.ttf` (or check first 4 bytes are `\x00\x01\x00\x00` / `true`/`OTTO`).

- [ ] **Step 3: Write failing render test**

`tests/render.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert';
import { renderSlidePngs } from '../api/_render.js';

// 1x1 red PNG
const PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('renders one PNG buffer per slide', async () => {
  const bufs = await renderSlidePngs({
    slides: [
      { index: 0, heading: '5 things I wish I knew before losing weight', body: '' },
      { index: 1, heading: 'Eat protein first', body: 'It keeps you full and protects muscle while you cut.' },
    ],
    style: 'bold',
    accent: '#22C55E',
    bgBase64: PX,
    watermark: true,
  });
  assert.equal(bufs.length, 2);
  for (const b of bufs) {
    assert.ok(Buffer.isBuffer(b));
    assert.equal(b.subarray(1, 4).toString('ascii'), 'PNG');
    assert.ok(b.length > 5000); // real 1080x1350 render, not an empty canvas
  }
});
```

- [ ] **Step 4: Run, verify fail** — `node --test tests/render.test.mjs` → FAIL (module missing).

- [ ] **Step 5: Create `api/_render.js`**

```js
// api/_render.js — Server-side slide rendering for autopilot posting.
// Uses the SAME drawSlideOn as the browser (slide-render.mjs) so posted
// slides are pixel-identical to the create-page preview.
// Vercel ignores _-prefixed files in api/ as endpoints.

import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { drawSlideOn, SLIDE_W, SLIDE_H } from '../slide-render.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fonts');
let fontsReady = false;

function registerFonts() {
  if (fontsReady) return;
  for (const f of ['Geist-Medium.ttf', 'Geist-ExtraBold.ttf', 'GeistMono-Medium.ttf']) {
    const p = join(FONT_DIR, f);
    if (existsSync(p)) GlobalFonts.registerFromPath(p, f.startsWith('GeistMono') ? 'Geist Mono' : 'Geist');
  }
  fontsReady = true;
}

export async function renderSlidePngs({ slides, style, accent, bgBase64, watermark }) {
  registerFonts();
  const bg = await loadImage(Buffer.from(bgBase64, 'base64'));
  const out = [];
  for (const slide of slides) {
    const canvas = createCanvas(SLIDE_W, SLIDE_H);
    const isLast = slide.index === slides.length - 1;
    drawSlideOn(canvas, bg, slide, slides.length, style, accent, {
      watermark: !!watermark && isLast,
      fontSans: 'Geist',
      fontMono: '"Geist Mono"',
    });
    out.push(canvas.toBuffer('image/png'));
  }
  return out;
}
```

Note `vercel.json` needs the fonts + slide-render.mjs traced into the function bundle — Vercel's nft follows the static `import`/`registerFromPath` only for imports; add to `vercel.json` top level:

```json
  "functions": {
    "api/autopilot.js": { "includeFiles": "{fonts/**,slide-render.mjs}", "maxDuration": 60 }
  }
```

(Add this key in Task 8 when `api/autopilot.js` exists; noted here for context.)

- [ ] **Step 6: Run test, verify pass** — `node --test tests/render.test.mjs` → PASS. Bonus manual check: write one buffer to scratchpad and open it — text sharp, no chip, watermark subtle.

- [ ] **Step 7: Commit**

```bash
git add api/_render.js fonts/ package.json package-lock.json tests/render.test.mjs
git commit -m "feat: server-side slide rendering via napi canvas + shared renderer"
```

---

### Task 7: upload-post client + /api/social endpoint

**Files:**
- Create: `api/_uploadpost.js`
- Create: `api/social.js` (serverless function #10)
- Modify: `api/_db.js` (posts helpers subset: `getPostsForUser`; `setUploadPostUsername`)
- Modify: `vercel.json` (rewrite)

**Interfaces:**
- Produces: `uploadPostEnabled() → boolean`; `createUploadPostUser(username) → api json`; `generateLinkUrl(username) → string (hosted linking URL)`; `uploadPhotos({ username, photos: Buffer[], title, caption, platforms: string[] }) → api json` — from `api/_uploadpost.js`. Endpoint `GET /api/social → { enabled, connected, username, posts: [...] }`, `POST /api/social {action:'link'} → { url }`.
- Consumes: `getSession` from `_db.js`.

- [ ] **Step 1: Create `api/_uploadpost.js`**

```js
// api/_uploadpost.js — upload-post.com API client (auto-posting aggregator).
// Feature-flagged on UPLOAD_POST_API_KEY: absent key = manual-export mode,
// every caller must check uploadPostEnabled() first.
// Docs: https://docs.upload-post.com
// Vercel ignores _-prefixed files in api/ as endpoints.

const BASE = 'https://api.upload-post.com/api';

export function uploadPostEnabled() {
  return !!process.env.UPLOAD_POST_API_KEY;
}

async function call(path, { method = 'POST', json, form } = {}) {
  const headers = { Authorization: `Apikey ${process.env.UPLOAD_POST_API_KEY}` };
  let body;
  if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form; // FormData sets its own content-type boundary
  const r = await fetch(BASE + path, { method, headers, body });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!r.ok) throw new Error(`upload-post ${path} ${r.status}: ${text.substring(0, 300)}`);
  return data;
}

// One upload-post "profile" per Hooklab customer. Idempotent-ish: treat
// "already exists" errors as success.
export async function createUploadPostUser(username) {
  try {
    return await call('/uploadposts/users', { json: { username } });
  } catch (e) {
    if (/exist/i.test(e.message)) return { username, existed: true };
    throw e;
  }
}

// Hosted linking page URL — customer connects their TikTok/Instagram there.
export async function generateLinkUrl(username) {
  const data = await call('/uploadposts/users/generate-jwt', { json: { username } });
  const url = data.access_url || data.url || data.link || '';
  if (!url) throw new Error('upload-post generate-jwt returned no URL: ' + JSON.stringify(data).substring(0, 200));
  return url;
}

export async function uploadPhotos({ username, photos, title, caption, platforms }) {
  const form = new FormData();
  form.append('user', username);
  for (const p of platforms) form.append('platform[]', p);
  form.append('title', (title || caption || '').substring(0, 150));
  if (caption) form.append('caption', caption);
  if (caption) form.append('description', caption); // TikTok/others use description
  photos.forEach((buf, i) => {
    form.append('photos[]', new Blob([buf], { type: 'image/png' }), `slide-${i + 1}.png`);
  });
  return call('/upload_photos', { form });
}
```

**Implementation note:** field names (`access_url`, `caption` vs `description`) must be verified against https://docs.upload-post.com/api-reference on first real call — the code above reads defensively, but adjust if the live API differs. This is runtime verification, not optional.

- [ ] **Step 2: Add DB helpers to `api/_db.js`** (new section before GATING)

```js
// ============================================
// AUTOPILOT: POSTS + SOCIAL LINK
// ============================================
export async function setUploadPostUsername(userId, username) {
  const sql = getSQL();
  await sql`UPDATE users SET upload_post_username = ${username}, updated_at = NOW() WHERE id = ${userId}`;
}

export async function getPostsForUser(userId, limit = 30) {
  const sql = getSQL();
  return sql`
    SELECT id, scheduled_at, status, kind, style, slides, caption, platforms, error, created_at
    FROM posts WHERE user_id = ${userId}
    ORDER BY scheduled_at DESC LIMIT ${limit}
  `;
}
```

- [ ] **Step 3: Create `api/social.js`**

```js
// api/social.js — Social account linking + post queue for the account page.
// GET  /api/social                 -> { enabled, connected, username, posts }
// POST /api/social {action:'link'} -> { url } (hosted upload-post linking page)

import { getSession, setUploadPostUsername, getPostsForUser } from './_db.js';
import { uploadPostEnabled, createUploadPostUser, generateLinkUrl } from './_uploadpost.js';

function cors(req, res) {
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  const allowed = !origin || (function () { try { return new URL(origin).host === host; } catch { return false; } })();
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') { res.status(200).end(); return true; }
  return false;
}

export default async function handler(req, res) {
  if (cors(req, res)) return;

  try {
    const user = await getSession(req).catch(() => null);
    if (!user) return res.status(401).json({ error: 'Sign in required.' });

    if (req.method === 'GET') {
      const posts = await getPostsForUser(user.id);
      return res.status(200).json({
        enabled: uploadPostEnabled(),
        connected: !!user.upload_post_username,
        username: user.upload_post_username || '',
        posts,
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

    if (body.action === 'link') {
      if (!uploadPostEnabled()) {
        return res.status(503).json({ error: 'Auto-posting is not enabled yet — download and post manually for now.' });
      }
      const username = user.upload_post_username || `hooklab-u${user.id}`;
      await createUploadPostUser(username);
      if (!user.upload_post_username) await setUploadPostUsername(user.id, username);
      const url = await generateLinkUrl(username);
      return res.status(200).json({ url });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    console.error('social error:', e);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
```

- [ ] **Step 4: vercel.json rewrite** — add to `rewrites`:

```json
    { "source": "/api/social", "destination": "/api/social" },
```

- [ ] **Step 5: Verify** — `node --check api/_uploadpost.js api/social.js api/_db.js` clean; `node --test tests/*.test.mjs` PASS.

- [ ] **Step 6: Commit**

```bash
git add api/_uploadpost.js api/social.js api/_db.js vercel.json
git commit -m "feat: upload-post client + /api/social link/status endpoint"
```

---

### Task 8: Autopilot cron — queue top-up + render + publish

**Files:**
- Create: `api/autopilot.js` (serverless function #11)
- Modify: `api/_db.js` (queue helpers)
- Modify: `vercel.json` (cron + functions.includeFiles)
- Test: `tests/schedule.test.mjs`

**Interfaces:**
- Produces: `GET /api/autopilot` (cron/`?secret=`) → `{ toppedUp, posted, failed, errors[] }`; DB helpers `getAutopilotUsers()`, `countFuturePosts(userId)`, `countAllPosts(userId)`, `createPost({...})`, `getDuePosts(limit)`, `setPostStatus(id, status, {error, externalIds, retries})`; pure `nextSlots(nowIso, existing, days) → Date[]` from `api/_generate.js`.
- Consumes: `generateCarouselPlan`, `postKind`, `backgroundPrompt` (`_generate.js`); `renderSlidePngs` (`_render.js`); `uploadPhotos`, `uploadPostEnabled` (`_uploadpost.js`); `callGeminiImage` (`_shared.js`).

- [ ] **Step 1: Write failing scheduling test**

`tests/schedule.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert';
import { nextSlots } from '../api/_generate.js';

test('fills up to N days ahead at 15:00 UTC, skipping taken days', () => {
  const now = '2026-07-13T08:00:00Z';
  const taken = [new Date('2026-07-14T15:00:00Z')];
  const slots = nextSlots(now, taken, 3);
  assert.equal(slots.length, 2); // day+1 taken -> today 15:00 + day+2
  assert.equal(slots[0].toISOString(), '2026-07-13T15:00:00.000Z');
  assert.equal(slots[1].toISOString(), '2026-07-15T15:00:00.000Z');
});

test('same-day slot skipped when 15:00 already past', () => {
  const slots = nextSlots('2026-07-13T16:30:00Z', [], 2);
  assert.equal(slots[0].toISOString(), '2026-07-14T15:00:00.000Z');
  assert.equal(slots[1].toISOString(), '2026-07-15T15:00:00.000Z');
});
```

- [ ] **Step 2: Run, verify fail** — `node --test tests/schedule.test.mjs` → FAIL.

- [ ] **Step 3: Add `nextSlots` to `api/_generate.js`**

```js
// Daily posting slots at 15:00 UTC (peak US morning/noon). Returns up to
// `days` future Date slots not already present in `existing`.
export function nextSlots(nowIso, existing, days) {
  const now = new Date(nowIso);
  const takenDays = new Set(existing.map((d) => new Date(d).toISOString().substring(0, 10)));
  const out = [];
  for (let i = 0; out.length < days && i < days + 7; i++) {
    const slot = new Date(now);
    slot.setUTCDate(slot.getUTCDate() + i);
    slot.setUTCHours(15, 0, 0, 0);
    if (slot <= now) continue;
    if (takenDays.has(slot.toISOString().substring(0, 10))) continue;
    out.push(slot);
  }
  return out;
}
```

- [ ] **Step 4: Run, verify pass** — `node --test tests/schedule.test.mjs` → PASS.

- [ ] **Step 5: Queue helpers in `api/_db.js`** (append to the AUTOPILOT section from Task 7)

```js
export async function getAutopilotUsers() {
  const sql = getSQL();
  return sql`
    SELECT * FROM users
    WHERE tier = 'pro'
      AND upload_post_username IS NOT NULL
      AND profile->>'what' IS NOT NULL
  `;
}

export async function countFuturePosts(userId) {
  const sql = getSQL();
  const rows = await sql`
    SELECT COUNT(*)::int AS n, COALESCE(array_agg(scheduled_at), '{}') AS at
    FROM posts WHERE user_id = ${userId} AND status = 'queued' AND scheduled_at > NOW()
  `;
  return { n: rows[0].n, scheduledAts: rows[0].at || [] };
}

export async function countAllPosts(userId) {
  const sql = getSQL();
  const rows = await sql`SELECT COUNT(*)::int AS n FROM posts WHERE user_id = ${userId}`;
  return rows[0].n;
}

export async function createPost({ userId, scheduledAt, kind, style, slides, caption, accent, motifs, platforms }) {
  const sql = getSQL();
  const rows = await sql`
    INSERT INTO posts (user_id, scheduled_at, kind, style, slides, caption, accent, motifs, platforms)
    VALUES (${userId}, ${scheduledAt}, ${kind}, ${style}, ${JSON.stringify(slides)},
            ${caption}, ${accent || ''}, ${JSON.stringify(motifs || [])}, ${platforms || ['tiktok', 'instagram']})
    RETURNING id
  `;
  return rows[0];
}

export async function getDuePosts(limit = 5) {
  const sql = getSQL();
  return sql`
    SELECT p.*, u.upload_post_username, u.profile, u.tier
    FROM posts p JOIN users u ON u.id = p.user_id
    WHERE p.status = 'queued' AND p.scheduled_at <= NOW()
    ORDER BY p.scheduled_at ASC
    LIMIT ${limit}
  `;
}

export async function setPostStatus(id, status, { error = '', externalIds = null, retries } = {}) {
  const sql = getSQL();
  await sql`
    UPDATE posts SET status = ${status}, error = ${error},
      external_ids = ${externalIds ? JSON.stringify(externalIds) : null},
      retries = COALESCE(${retries ?? null}, retries)
    WHERE id = ${id}
  `;
}
```

- [ ] **Step 6: Create `api/autopilot.js`**

```js
// api/autopilot.js — The product. Daily cron:
//   Phase 1 (top-up): every connected Autopilot subscriber keeps 3 days of
//     posts queued, 75/25 value/showcase rotation.
//   Phase 2 (publish): render due posts server-side and push to TikTok +
//     Instagram via upload-post. One retry, then failed + surfaced.
// GET /api/autopilot?secret=$ADMIN_SECRET (or Vercel cron)

import {
  getAutopilotUsers, countFuturePosts, countAllPosts, createPost,
  getDuePosts, setPostStatus, consumeCarousel, canGenerateCarousel,
} from './_db.js';
import { generateCarouselPlan, postKind, backgroundPrompt, nextSlots, cleanMotifs } from './_generate.js';
import { renderSlidePngs } from './_render.js';
import { uploadPostEnabled, uploadPhotos } from './_uploadpost.js';
import { callGeminiImage } from './_shared.js';

export const maxDuration = 60;

const QUEUE_DAYS = 3;
const MAX_PUBLISH_PER_RUN = 5;
const MAX_TOPUP_USERS_PER_RUN = 6;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const isCron = !!req.headers['x-vercel-cron'];
  const secretOk = process.env.ADMIN_SECRET && req.query.secret === process.env.ADMIN_SECRET;
  if (!isCron && !secretOk) return res.status(401).json({ error: 'Unauthorized' });

  const errors = [];
  let toppedUp = 0, posted = 0, failed = 0;

  // ===== Phase 1: top up queues =====
  try {
    const users = (await getAutopilotUsers()).slice(0, MAX_TOPUP_USERS_PER_RUN);
    for (const user of users) {
      try {
        const gate = canGenerateCarousel(user);
        if (!gate.allowed) continue; // fair-use cap reached this month
        const { n, scheduledAts } = await countFuturePosts(user.id);
        if (n >= QUEUE_DAYS) continue;
        const slots = nextSlots(new Date().toISOString(), scheduledAts, QUEUE_DAYS - n);
        let total = await countAllPosts(user.id);
        for (const slot of slots) {
          const plan = await generateCarouselPlan({ profile: user.profile, kind: postKind(total) });
          await createPost({
            userId: user.id, scheduledAt: slot.toISOString(), kind: postKind(total),
            style: plan.style, slides: plan.slides, caption: plan.caption,
            accent: plan.accent, motifs: plan.motifs,
          });
          await consumeCarousel(user, 'pro');
          user.carousels_used = (user.carousels_used || 0) + 1;
          total++; toppedUp++;
        }
      } catch (e) { errors.push(`topup u${user.id}: ${e.message}`); }
    }
  } catch (e) { errors.push(`topup: ${e.message}`); }

  // ===== Phase 2: publish due posts =====
  if (uploadPostEnabled()) {
    const due = await getDuePosts(MAX_PUBLISH_PER_RUN).catch((e) => { errors.push(`due: ${e.message}`); return []; });
    for (const post of due) {
      try {
        const bgB64 = await callGeminiImage(
          backgroundPrompt(post.style, post.profile, cleanMotifs(post.motifs), post.accent)
        );
        const pngs = await renderSlidePngs({
          slides: post.slides, style: post.style, accent: post.accent,
          bgBase64: bgB64, watermark: false, // autopilot = paid = never watermarked
        });
        const result = await uploadPhotos({
          username: post.upload_post_username, photos: pngs,
          title: post.slides[0]?.heading || '', caption: post.caption,
          platforms: post.platforms || ['tiktok', 'instagram'],
        });
        await setPostStatus(post.id, 'posted', { externalIds: result });
        posted++;
      } catch (e) {
        if ((post.retries || 0) < 1) {
          await setPostStatus(post.id, 'queued', { error: e.message, retries: (post.retries || 0) + 1 });
        } else {
          await setPostStatus(post.id, 'failed', { error: e.message });
          failed++;
        }
        errors.push(`post ${post.id}: ${e.message}`);
      }
    }
  }

  return res.status(200).json({ toppedUp, posted, failed, errors });
}
```

- [ ] **Step 7: vercel.json** — add cron, rewrite, and function config:

```json
  "crons": [
    { "path": "/api/mine", "schedule": "0 6 * * *" },
    { "path": "/api/autopilot", "schedule": "30 14 * * *" }
  ],
```

(14:30 UTC run renders/publishes the 15:00 slots created ≥1 day earlier — cron drift on Hobby can be up to ~1h, so due-check uses `<= NOW()` and the NEXT run catches anything missed. Posts created "today at 15:00" by phase 1 publish tomorrow.) Add rewrite `{ "source": "/api/autopilot", "destination": "/api/autopilot" }` and the `functions` block from Task 6 Step 5:

```json
  "functions": {
    "api/autopilot.js": { "includeFiles": "{fonts/**,slide-render.mjs}" }
  }
```

- [ ] **Step 8: Verify** — `node --check api/autopilot.js api/_db.js api/_generate.js` clean; full `node --test tests/*.test.mjs` PASS. Runtime smoke deferred to deploy: `GET /api/autopilot?secret=...` on prod returns `{toppedUp:0, posted:0, ...}` with no connected users — harmless.

- [ ] **Step 9: Commit**

```bash
git add api/autopilot.js api/_db.js api/_generate.js vercel.json tests/schedule.test.mjs
git commit -m "feat: autopilot cron — queue top-up, server render, upload-post publish"
```

---

### Task 9: Pricing + UI (checkout, landing, account, create copy)

**Files:**
- Modify: `api/checkout.js`, `api/auth/google.js:18-20`, `api/auth/callback.js:86-89`
- Modify: `index.html` (pricing + hero copy), `account.html` (connect + queue UI), `create.html` (tier copy)

**Interfaces:**
- Consumes: `GET /api/social`, `POST /api/social {action:'link'}` (Task 7); `auth/me` fields (Task 1).
- Produces: `?plan=autopilot` checkout path (uses `STRIPE_AUTOPILOT_PRICE_ID`, falls back to `STRIPE_PRO_PRICE_ID`).

- [ ] **Step 1: checkout.js plan handling**

In `sessionParams`, replace the price line:

```js
      price: isCredits
        ? process.env.STRIPE_CREDITS_PRICE_ID
        : (process.env.STRIPE_AUTOPILOT_PRICE_ID || process.env.STRIPE_PRO_PRICE_ID),
```

In the GET handler accept the new alias: `if (plan === 'pro' || plan === 'credits' || plan === 'autopilot')` and treat `autopilot` as subscription (i.e. `const isCredits = plan === 'credits'` already handles it). Also update the tier short-circuit: `if ((plan === 'pro' || plan === 'autopilot') && user.tier === 'pro')`. POST: `const plan = body && body.plan === 'credits' ? 'credits' : (body && body.plan === 'autopilot' ? 'autopilot' : 'pro');`

- [ ] **Step 2: OAuth plan cookie whitelist**

`api/auth/google.js:19`: `if (req.query && ['pro', 'credits', 'autopilot'].includes(req.query.plan))`. `api/auth/callback.js`: find the `checkoutPlan` validation near line 87 and ensure `autopilot` passes through to `/api/checkout?plan=autopilot` (mirror whatever whitelist form exists there).

- [ ] **Step 3: index.html pricing + copy**

Locate the pricing section (grep for `$9` / `pricing`). Rework to TWO columns (delete the $5 credits column):
- **Free** — "3 carousels, watermarked. Taste the quality." CTA: "Start free".
- **Autopilot — $19/mo** — "A post on your TikTok + Instagram every day. Generated, rendered, published. No filming, no writing, no showing up." CTA: `/api/checkout?plan=autopilot`. Badge line: "competitors charge $49+ for this".
Hero subline: "Your app's faceless TikTok + Instagram, on autopilot." Keep the design system (pills, mono cards, single kicker). Also FAQ: update the entries mentioning credits/1-free to 3-free + $19 autopilot (grep `credit` and `free carousel` in index.html).

- [ ] **Step 4: account.html — connect + queue**

Add a "Autopilot" card (follow existing card markup patterns):
- If `me.socialConnected` false: button "Connect TikTok + Instagram" → `POST /api/social {action:'link'}` → `window.open(j.url)`; on 503 show its error text (manual mode message).
- If connected: "Connected ✓" + queue list from `GET /api/social` — for each post: date (`scheduled_at` → local date), kind, status pill (`queued`/`posted`/`failed` + error text when failed), first slide heading.
- Plan row: show "Autopilot $19/mo" for tier pro; usage `carouselsUsed/30`; free users see `freeCarouselsUsed/3 free carousels used` + upgrade CTA.

- [ ] **Step 5: create.html copy**

Grep create.html for `free carousel` / `$5` / `Pro` strings: change "your free carousel is ready · watermark on last slide" → "free carousel N of 3 · subtle watermark on last slide" (read `freeCarouselsUsed` from `/api/auth/me` data already fetched); upgrade prompts → "$19/mo Autopilot — posted for you daily" linking `/api/checkout?plan=autopilot`.

- [ ] **Step 6: Verify** — `node --check api/checkout.js api/auth/google.js api/auth/callback.js`; serve pages locally, click through: pricing renders 2 columns, account card renders in signed-out mock (elements exist), no console errors.

- [ ] **Step 7: Commit**

```bash
git add api/checkout.js api/auth/google.js api/auth/callback.js index.html account.html create.html
git commit -m "feat: $19 autopilot pricing, connect + queue UI, free-3 copy"
```

---

### Task 10: Full verification + docs

**Files:**
- Modify: `docs/superpowers/smoke-checklist.md` (rewrite for autopilot)
- Modify: `README.md` env var list if present

- [ ] **Step 1: Run everything**

```bash
node --test tests/*.test.mjs
node --check api/*.js api/auth/*.js
```

Expected: all tests PASS, all checks clean.

- [ ] **Step 2: End-to-end local drive (mock where env missing)**

Use the scratchpad mockserver pattern (mock `/api/*`, `?autogen=1`): create page generates → slides render with no chips + subtle watermark → ZIP downloads. Screenshot for the user.

- [ ] **Step 3: Rewrite `docs/superpowers/smoke-checklist.md`**

New checklist: profile import derives audience_niche (calorie app → fitness, NOT appdev); generation reads as one arc; free-3 gating; `/api/social` link flow (needs UPLOAD_POST_API_KEY); `/api/autopilot?secret=` dry behavior; pricing page; Stripe `plan=autopilot` checkout. Mark USER ACTIONS: create $19 Stripe price + set `STRIPE_AUTOPILOT_PRICE_ID`, set `UPLOAD_POST_API_KEY` when first customer pays, run `scripts/migrate-autopilot.sql` if not done in Task 1.

- [ ] **Step 4: Commit + report**

```bash
git add docs/
git commit -m "docs: autopilot smoke checklist"
```

Report to user: what's live, what needs their action (Stripe price, migration if deferred, upload-post signup, GitHub Desktop push, prod deploy smoke).

---

## Self-Review Notes (done at plan time)

- Spec coverage: §1 audience-niche → Tasks 2-3; §2 narrative + render tweaks → Tasks 4-5; §3 calendar/auto-post/server render → Tasks 6-8; §4 pricing → Tasks 1, 9; migration notes → Task 1; success criteria → Task 10.
- Function count: 11/12 after Tasks 7-8. Cron count: 2/2.
- Type consistency: `generateCarouselPlan` return `{hook, style, slides, caption, motifs, accent}` consumed identically in carousel.js (Task 4) and autopilot.js (Task 8). `posts.slides` JSONB shape `[{index, heading, body}]` matches `renderSlidePngs` input. `consumeCarousel(user, 'pro')` matches Task 1 signature.
- Known runtime-verify items (not placeholders — code written, must be confirmed live): upload-post response field names (Task 7 note), Geist TTF sourcing (Task 6 Step 2 self-verifying via `file` check), Vercel `includeFiles` tracing fonts (Task 8 deploy smoke).
