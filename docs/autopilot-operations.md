# Autopilot operations

Autopilot keeps queue generation and social publishing independent. All cron
expressions are UTC; Vercel Hobby may invoke a daily cron at any point in the
following one-hour window.

| Worker | Schedule | Purpose |
| --- | --- | --- |
| `/api/autopilot-topup` | `0 17 * * *` | Fill each eligible account to three future posts. |
| `/api/autopilot-topup-recovery` | `0 19 * * *` | Retry transient planning/database failures. |
| `/api/autopilot` | `30 20 * * *` | Verify provider jobs, then submit due posts. |
| `/api/autopilot-recovery` | `0 22 * * *` | Verify async results and pick up missed/deferred posts. |

## Evidence and alerting

- Every authenticated invocation inserts an `autopilot_runs` row and finishes
  it with a status, counters, duration, and bounded error details.
- Every start, operation failure, and finish emits one structured JSON log with
  a `runId` that matches the database row.
- `/api/health` exposes only sanitized worker state and timestamps. It returns
  HTTP 503 when a worker failed, was interrupted, or stopped checking in. Point
  any external uptime monitor at this URL for proactive alerts.
- If `AUTOPILOT_ALERT_WEBHOOK_URL` is configured, a failed run also sends a JSON
  webhook immediately. This is optional; the database, Account UI, and health
  endpoint do not depend on it.
- Cron routes require Vercel's `Authorization: Bearer $CRON_SECRET` header.
  Caller-supplied marker headers are not trusted; manual runs use
  `?secret=$ADMIN_SECRET`.

## Post state machine

`queued` or `blocked` -> `publishing` -> `submitted` -> `verifying` -> `posted`

- Database claims use `FOR UPDATE SKIP LOCKED`, so overlapping cron/manual runs
  cannot work the same post concurrently.
- Uploads use a stable `hooklab-post-{post id}` idempotency key. A timeout after
  the provider accepted a post is safe to retry without creating a duplicate.
- Interrupted `publishing` claims return to `queued` after 15 minutes;
  interrupted `verifying` claims return to `submitted`.
- Technical failures before provider acceptance get one automatic retry.
  Terminal provider failures do not auto-resubmit because one social platform
  may already have succeeded; the Account UI exposes the exact action needed.
- A run approaching its Vercel time limit releases unstarted claims back to the
  queue for the recovery worker instead of being killed mid-state.

## Database setup

Workers run the small reliability migration idempotently at startup so deploys
cannot race a manual database change. The same source-of-truth SQL is available
at `scripts/migrate-autopilot-reliability.sql` for explicit environment setup.
