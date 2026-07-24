# Admin Dashboard — Design (2026-07-24)

## Purpose

One private page (`/admin`) where the owner monitors the whole product from any
device: business (money), usage (product activity), ops (pipelines/health), and
costs (provider spend). Read-only v1 — no admin actions.

## Constraints

- Vercel Hobby plan: **12 serverless functions max, already at 12.** No new
  function files. Admin API lives inside `api/health.js` behind `?admin=1`.
- CSP `script-src 'self' 'unsafe-inline'`: no chart libraries. Charts are
  hand-rolled inline SVG.
- No new env vars, no new secrets. Reuses `ADMIN_SECRET`, `STRIPE_SECRET_KEY`,
  existing Google auth.

## Auth (two doors, both server-side)

1. **Primary — Google session allowlist.** `getSession(req)` → user email must
   be in `ADMIN_EMAILS = ['ashpimmyt2@gmail.com']` (constant in code). One tap
   on phone, nothing to paste or store.
2. **Fallback — `Authorization: Bearer $ADMIN_SECRET`**, header only (query
   `?secret=` deliberately NOT accepted here), compared with
   `crypto.timingSafeEqual`. For scripts/curl.

`admin.html` is a public static file but renders an empty sign-in shell until
the API authenticates; it contains no data. `<meta name="robots"
content="noindex">`, linked from nowhere. Unauthed `?admin=1` returns the same
public health payload as today (admin mode invisible to outsiders — no 401
oracle).

## Cost logging (`api_usage` table)

All Gemini traffic already funnels through `callGemini` / `callGeminiImage` in
`_shared.js`; all Supadata traffic through `_transcript.js`. Log at those choke
points — fire-and-forget, never blocks or fails the caller.

```sql
CREATE TABLE IF NOT EXISTS api_usage (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  provider TEXT NOT NULL,        -- 'gemini' | 'supadata'
  op TEXT NOT NULL,              -- 'text' | 'image' | 'transcript'
  units NUMERIC NOT NULL DEFAULT 1,
  in_tokens INTEGER,
  out_tokens INTEGER,
  est_cost_micros BIGINT NOT NULL DEFAULT 0   -- USD micros, no floats
);
CREATE INDEX IF NOT EXISTS api_usage_created_idx ON api_usage (created_at);
```

Lazy `ensureUsageSchema()` (same pattern as `ensureAnonSchema`). Prices as code
constants: gemini-2.5-flash $0.30/M in + $2.50/M out (from response
`usageMetadata`); gemini-2.5-flash-image $0.039/image; Supadata logged as
credits (units) with cost 0 — plan pricing isn't per-unit, dashboard shows
credits used instead.

## Admin API payload (`GET /api/health?admin=1`, authed)

One JSON response, all queries in parallel:

- **business**: Stripe live — active subscriptions with plan + amount → MRR,
  last 10 payments (amount, email, date), total revenue this month; DB —
  users total / new 7d / pro count.
- **usage**: carousels per day (30 days), posts published per day (30 days),
  anon slots used today vs cap, total hooks, swipe saves, carousels total.
- **ops**: last 10 autopilot runs (started, ok, posts, reason), per-niche hook
  counts + last-mined age, post_metrics freshness, queued/scheduled posts,
  DB size (`pg_database_size`).
- **costs**: api_usage rollup per provider per day (30 days) — calls, units,
  tokens, est $; month-to-date $ per provider; Stripe fees are shown as part
  of payments. Link-out cards for Vercel / Google AI Studio / Supadata
  dashboards (no APIs available).

Stripe calls wrapped in try/catch — dashboard still renders DB sections if
Stripe is down/slow (section-level `error` fields, 4s timeout per section).

## UI (`admin.html` + `/admin` rewrite)

hooklab.css design system (pure-black, pills, Geist, radius-24 cards,
`--signal` #FFDD00 sparingly). Vanilla JS. Layout:

- Top bar: "Ops" wordmark, refresh button + auto-refresh 60s, signed-in chip.
- **KPI row**: MRR · users · posts today · month spend (4 stat tiles).
- **Money**: payments list + subs table.
- **Activity**: 30-day carousels/day + posts/day SVG bar/line charts.
- **Pipelines**: autopilot run list (ok/fail dots), niche hook table with
  staleness colors, anon slot meter.
- **Spend**: per-provider daily stacked bars + MTD numbers, link-out cards.

Mobile-first: single column stack on phone, 2-col grid desktop. Charts follow
dataviz skill rules (muted grid, one accent, no chartjunk).

## Testing

Node test files (existing invocation pattern): admin auth gate (session
allowlist, bearer header ok, query secret rejected, unauthed → public
payload), cost math (token → micros), usage logging never throws.

## Out of scope (v1)

Admin actions (refunds, user edits), Vercel usage API, email alerts,
historical MRR chart.
