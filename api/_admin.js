// api/_admin.js — Owner dashboard: auth gate + metrics aggregation.
// Vercel ignores _-prefixed files in api/ as endpoints. Served through
// /api/health?admin=1 (the function cap is full, so no new endpoint file).

import crypto from 'crypto';
import Stripe from 'stripe';
import { getSQL, getSession, ensureUsageSchema } from './_db.js';
import { anonDailyCap } from './_anon.js';

// The only accounts allowed into the dashboard via Google sign-in.
export const ADMIN_EMAILS = ['ashpimmyt2@gmail.com'];

const SECTION_TIMEOUT_MS = 6_000;

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Header-only on purpose: query-string secrets leak into logs and history.
// Constant-time compare, unlike the legacy adminSecretOk used by cron routes.
export function adminBearerOk(req) {
  const admin = process.env.ADMIN_SECRET;
  if (!admin) return false;
  const auth = req.headers?.authorization || '';
  if (!auth.startsWith('Bearer ')) return false;
  return safeEqual(auth.slice(7), admin);
}

export async function isAdminRequest(req, deps = {}) {
  const bearerOk = (deps.adminBearerOk || adminBearerOk)(req);
  if (bearerOk) return true;
  try {
    const user = await (deps.getSession || getSession)(req);
    const email = String(user?.email || '').toLowerCase();
    return !!email && ADMIN_EMAILS.includes(email);
  } catch {
    return false;
  }
}

// Run a section with a timeout; a slow or broken provider degrades that one
// card instead of blanking the whole dashboard.
async function section(fn) {
  try {
    const data = await Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('section timeout')), SECTION_TIMEOUT_MS)),
    ]);
    return { ok: true, ...data };
  } catch (error) {
    return { ok: false, error: String(error?.message || error).substring(0, 200) };
  }
}

async function businessSection() {
  const sql = getSQL();
  const usersP = sql`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS new7d,
           COUNT(*) FILTER (WHERE tier = 'pro')::int AS pro,
           COUNT(*) FILTER (WHERE upload_post_username IS NOT NULL)::int AS connected
    FROM users
  `;

  let stripe = null;
  if (process.env.STRIPE_SECRET_KEY) stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const monthStartUnix = Math.floor(monthStart.getTime() / 1000);

  // Newest accounts with their activity — the founder follow-up list: who
  // signed up, whether they ever generated, and when they were last active.
  const signupsP = sql`
    SELECT u.email, u.created_at, u.tier,
           (u.upload_post_username IS NOT NULL) AS connected,
           (SELECT COUNT(*)::int FROM carousels c WHERE c.user_id = u.id) AS carousels,
           (SELECT MAX(c.created_at) FROM carousels c WHERE c.user_id = u.id) AS last_active_at
    FROM users u
    ORDER BY u.created_at DESC
    LIMIT 30
  `;

  const [users, signups, subsRes, chargesRes, monthChargesRes] = await Promise.all([
    usersP,
    signupsP,
    stripe ? stripe.subscriptions.list({ status: 'active', limit: 100, expand: ['data.customer'] }) : null,
    stripe ? stripe.charges.list({ limit: 10 }) : null,
    stripe ? stripe.charges.list({ created: { gte: monthStartUnix }, limit: 100 }) : null,
  ]);

  let mrrCents = 0;
  const subs = (subsRes?.data || []).map((s) => {
    let cents = 0;
    for (const item of s.items?.data || []) {
      const amount = (item.price?.unit_amount || 0) * (item.quantity || 1);
      cents += item.price?.recurring?.interval === 'year' ? Math.round(amount / 12) : amount;
    }
    mrrCents += cents;
    return {
      email: s.customer?.email || '',
      amountCents: cents,
      interval: s.items?.data?.[0]?.price?.recurring?.interval || 'month',
      since: s.start_date ? new Date(s.start_date * 1000).toISOString() : null,
      cancelAtPeriodEnd: !!s.cancel_at_period_end,
    };
  });

  const payments = (chargesRes?.data || []).map((c) => ({
    amountCents: c.amount,
    currency: c.currency,
    email: c.billing_details?.email || c.receipt_email || '',
    created: new Date(c.created * 1000).toISOString(),
    status: c.status,
    refunded: !!c.refunded,
  }));

  let monthRevenueCents = 0;
  for (const c of monthChargesRes?.data || []) {
    if (c.paid && c.status === 'succeeded') monthRevenueCents += c.amount - (c.amount_refunded || 0);
  }

  return {
    users: users[0],
    signups,
    stripe: !!stripe,
    mrrCents,
    subs,
    payments,
    monthRevenueCents,
  };
}

async function usageSection() {
  const sql = getSQL();
  const [carouselsPerDay, postsPerDay, totals, anonToday] = await Promise.all([
    sql`
      SELECT date_trunc('day', created_at)::date AS day, COUNT(*)::int AS count
      FROM carousels
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY 1 ORDER BY 1
    `,
    sql`
      SELECT date_trunc('day', scheduled_at)::date AS day, COUNT(*)::int AS count
      FROM posts
      WHERE status = 'posted' AND scheduled_at > NOW() - INTERVAL '30 days'
      GROUP BY 1 ORDER BY 1
    `,
    sql`
      SELECT
        (SELECT COUNT(*)::int FROM carousels) AS carousels,
        (SELECT COUNT(*)::int FROM hooks) AS hooks,
        (SELECT COUNT(*)::int FROM posts) AS posts,
        (SELECT COUNT(*)::int FROM posts WHERE status = 'posted') AS posted
    `,
    sql`
      SELECT COUNT(*) FILTER (
        WHERE status = 'completed' AND created_at > date_trunc('day', NOW())
      )::int AS used
      FROM anon_slots
    `.catch(() => [{ used: 0 }]),
  ]);

  return {
    carouselsPerDay,
    postsPerDay,
    totals: totals[0],
    anonToday: { used: anonToday[0]?.used || 0, cap: anonDailyCap() },
  };
}

async function opsSection() {
  const sql = getSQL();
  const [runs, niches, queue, metrics, db] = await Promise.all([
    sql`
      SELECT id, job, trigger, status, started_at, finished_at, duration_ms, stats, errors
      FROM autopilot_runs
      ORDER BY started_at DESC
      LIMIT 12
    `.catch(() => []),
    sql`
      SELECT n.slug, n.name, n.last_mined_at,
             (SELECT COUNT(*)::int FROM hooks h WHERE h.niche_id = n.id) AS hooks
      FROM niches n
      WHERE n.active = TRUE
      ORDER BY n.name
    `,
    sql`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('queued', 'blocked') AND scheduled_at <= NOW())::int AS due,
        COUNT(*) FILTER (WHERE status IN ('queued', 'publishing', 'submitted', 'verifying', 'blocked') AND scheduled_at > NOW())::int AS future,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
        COUNT(*) FILTER (WHERE status = 'posted' AND scheduled_at > date_trunc('day', NOW()))::int AS posted_today,
        MIN(scheduled_at) FILTER (WHERE status IN ('queued', 'publishing', 'submitted', 'verifying', 'blocked') AND scheduled_at > NOW()) AS next_at
      FROM posts
    `,
    sql`SELECT MAX(captured_at) AS fresh_at FROM post_metrics`.catch(() => [{ fresh_at: null }]),
    sql`SELECT pg_database_size(current_database())::bigint AS bytes`,
  ]);

  return {
    runs,
    niches,
    queue: queue[0],
    metricsFreshAt: metrics[0]?.fresh_at || null,
    dbBytes: Number(db[0]?.bytes || 0),
  };
}

async function costsSection() {
  await ensureUsageSchema();
  const sql = getSQL();
  const [days, mtd] = await Promise.all([
    sql`
      SELECT date_trunc('day', created_at)::date AS day, provider,
             COUNT(*)::int AS calls,
             COALESCE(SUM(units), 0)::float AS units,
             COALESCE(SUM(in_tokens), 0)::bigint AS in_tokens,
             COALESCE(SUM(out_tokens), 0)::bigint AS out_tokens,
             COALESCE(SUM(est_cost_micros), 0)::bigint AS cost_micros
      FROM api_usage
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY 1, 2 ORDER BY 1
    `,
    sql`
      SELECT provider,
             COUNT(*)::int AS calls,
             COALESCE(SUM(est_cost_micros), 0)::bigint AS cost_micros
      FROM api_usage
      WHERE created_at >= date_trunc('month', NOW())
      GROUP BY 1 ORDER BY 1
    `,
  ]);

  return {
    days: days.map((d) => ({ ...d, in_tokens: Number(d.in_tokens), out_tokens: Number(d.out_tokens), cost_micros: Number(d.cost_micros) })),
    mtd: mtd.map((d) => ({ ...d, cost_micros: Number(d.cost_micros) })),
  };
}

export async function buildAdminPayload() {
  const [business, usage, ops, costs] = await Promise.all([
    section(businessSection),
    section(usageSection),
    section(opsSection),
    section(costsSection),
  ]);
  return {
    ok: true,
    admin: true,
    generatedAt: new Date().toISOString(),
    business,
    usage,
    ops,
    costs,
  };
}
