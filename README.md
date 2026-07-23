# Promote.dev

Promote.dev turns one product link into complete, faceless social posts for apps and SaaS products. It researches hook patterns that recently earned disproportionate attention in the product's buyers' niche, adapts the strongest fit to the product, and produces six designed slides, a caption, hashtags, and an optional vertical Reel.

Pro members can connect Instagram for daily post creation and publishing.

## What the product does

1. A founder pastes an App Store, Play Store, SaaS, or product-page URL.
2. Promote.dev reads the page and drafts a reusable product profile:
   - Product name and description
   - Target customer
   - Strongest customer outcome
   - Verified product facts
   - Brand color
   - The content niche the product's buyers watch
3. The hook engine finds recent short-form openings in that buyer niche.
4. AI selects a hook that transfers cleanly to the product and builds one coherent six-slide story around it.
5. Promote.dev generates:
   - Six 1080x1350 carousel slides
   - A photographic cover when appropriate
   - A ready-to-post caption
   - Up to eight niche-relevant hashtags
   - A product-specific call to action
6. The user can download the complete post, copy the caption, regenerate the visual direction, or choose a hook and style manually.
7. Pro users can render a silent 1080x1920 Reel or connect Instagram for daily scheduled publishing.

## Why the hook research is different

Promote.dev does not label an idea "proven" because an AI model suggested it. Mined hook sources must pass measurable quality gates:

- Published within the most recent 120 days
- At least 250,000 views, regardless of source-account size
- A usable spoken transcript
- The extracted line is grounded near the start of that transcript
- Explicit English-language, niche-relevance, non-ad, quality, and transferability checks
- A reusable template derived from the spoken hook rather than the video title

The system preserves the source opening's reusable tension, contrast, specificity, or curiosity. It does not copy the source topic. Product claims are limited to facts extracted from or approved in the user's product profile.

## Plans

### Free

- Three complete posts in total
- Six slides, caption, hashtags, and download files
- Evidence-backed automatic hook selection
- Small `made with promote.dev` watermark on the final slide

### Pro — $19/month

- 30 complete posts per monthly billing period
- No watermark
- Downloadable 9:16 Reel exports
- Daily Instagram publishing
- Publishing queue and delivery-status history
- Customer-managed cancellation through Stripe

Legacy purchased credits are still honored but are no longer sold.

## Product routes

| Route | Purpose |
|---|---|
| `/` | Public acquisition page, real output, evidence method, pricing, and FAQs |
| `/feed` | Temporarily redirects to Create while hook quality is retuned |
| `/create` | Product-profile setup, post creation, downloads, Reels, and post history |
| `/account` | Plan usage, billing, Instagram connection, queue, and publishing health |
| `/privacy` | Privacy policy |
| `/terms` | Terms of service |

The legacy aliases `/library`, `/studio`, and `/profile` redirect to the current routes.

## Main APIs

| Endpoint | Purpose |
|---|---|
| `/api/auth/google`, `/api/auth/callback`, `/api/auth/me` | Google OAuth and session management |
| `/api/profile` | Product-page import and reusable product profile |
| `/api/hooks` | Internal hook picker and existing saved-hook records |
| `/api/carousel` | Post planning, background/cover generation, history, and Reel jobs |
| `/api/social` | Instagram connection and publishing queue |
| `/api/autopilot` | Daily queue creation, publishing, verification, and recovery |
| `/api/mine` | Scheduled buyer-niche hook research |
| `/api/checkout`, `/api/webhook` | Stripe subscription lifecycle |
| `/api/health` | Publishing-worker health |

## Architecture

- Frontend: static HTML, CSS, and vanilla JavaScript
- Hosting and serverless functions: Vercel
- Database: Neon Postgres
- Authentication: Google OAuth
- Copy and image generation: Google Gemini
- Hook discovery: YouTube Data API
- Spoken transcript retrieval: Supadata
- Billing: Stripe
- Social connection and publishing: Upload-Post
- Reel rendering: Shotstack
- Shared slide renderer: Canvas in the browser and `@napi-rs/canvas` on the server

The browser preview, downloaded slides, Reels, and automatically published slides share the same rendering module so their typography and layout stay aligned.

## Local development

Requirements:

- Node.js 20 or newer
- Vercel CLI
- A Postgres database
- Credentials for the services used by the flows you want to exercise

Install and start:

```powershell
npm install
npm run dev
```

The development script runs `vercel dev`.

## Environment variables

### Core

- `POSTGRES_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GEMINI_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_AUTOPILOT_PRICE_ID`

### Hook research

- `YOUTUBE_API_KEY`
- `SUPADATA_API_KEY`

### Daily Instagram publishing

- `UPLOAD_POST_API_KEY`
- `CRON_SECRET`
- `ADMIN_SECRET`
- `AUTOPILOT_ALERT_WEBHOOK_URL` (optional)

### Reel rendering

- `SHOTSTACK_API_KEY`
- `SHOTSTACK_ENV`
- `REEL_SIGNING_SECRET`
- `REEL_PUBLIC_BASE_URL` (optional)

Legacy Stripe price variables remain supported for existing accounts but should not be used for new offers.

## Database

`schema.sql` contains the original schema and the product's accumulated core tables. Later capabilities are applied through migrations in `scripts/`, including:

- `migrate-hooklab.sql`
- `migrate-pivot.sql`
- `migrate-autopilot.sql`
- `migrate-autopilot-reliability.sql`
- `migrate-hero.sql`
- `migrate-reels.sql`
- `migrate-carousel-bg.sql`
- `retune-audience-niches.sql`

Run a migration with:

```powershell
node scripts/run-migration.mjs scripts/migrate-autopilot.sql
```

Review migrations before applying them and run them in chronological dependency order.

## Operations

- [Hook mining dry runs and fresh niche rebuilds](docs/hook-mining-operations.md)
- [Autopilot monitoring and recovery](docs/autopilot-operations.md)
- [Reel rendering](docs/reel-operations.md)

## Tests

The Node test suite covers:

- Usage gating and monthly resets
- Hook scoring, freshness, and language gates
- Product-to-audience niche handling
- Hook selection and generated-post safeguards
- Slide and Reel rendering
- Reel job security and recovery
- Instagram provider response handling
- Daily scheduling and publishing reliability
- Cron authentication and Vercel limits

PowerShell:

```powershell
$tests = (Get-ChildItem tests -Filter '*.test.mjs').FullName
node --test $tests
```

## Naming and legacy internals

The customer-facing product is Promote.dev. Some internal filenames, database names, routes, migration names, and idempotency keys still use `hooklab` or `carousel`. They are intentionally retained to avoid breaking deployed data and integrations; they are not the current product positioning.
