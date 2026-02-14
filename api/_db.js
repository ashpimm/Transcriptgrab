// api/_db.js — Database + session helpers
// Vercel ignores _-prefixed files in api/ as endpoints.

import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';

function getSQL() {
  return neon(process.env.POSTGRES_URL);
}

// ============================================
// COOKIE HELPERS
// ============================================
export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  header.split(';').forEach(function (pair) {
    const idx = pair.indexOf('=');
    if (idx < 0) return;
    const key = pair.substring(0, idx).trim();
    const val = pair.substring(idx + 1).trim();
    cookies[key] = decodeURIComponent(val);
  });
  return cookies;
}

export function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `tg_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'tg_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
}

// ============================================
// SESSION
// ============================================
export async function getSession(req) {
  const cookies = parseCookies(req);
  const token = cookies.tg_session;
  if (!token || token.length !== 64) return null;

  const sql = getSQL();
  const rows = await sql`
    SELECT s.user_id, s.expires_at, u.*
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ${token} AND s.expires_at > NOW()
  `;

  if (rows.length === 0) return null;

  const user = rows[0];

  // Auto-reset monthly usage if past reset date
  if (user.usage_reset_at && new Date(user.usage_reset_at) <= new Date()) {
    await sql`
      UPDATE users
      SET monthly_usage = 0,
          usage_reset_at = date_trunc('month', NOW()) + INTERVAL '1 month',
          updated_at = NOW()
      WHERE id = ${user.id}
    `;
    user.monthly_usage = 0;
  }

  return user;
}

export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const sql = getSQL();
  await sql`
    INSERT INTO sessions (id, user_id, expires_at)
    VALUES (${token}, ${userId}, NOW() + INTERVAL '30 days')
  `;
  return token;
}

// ============================================
// GENERATION GATING
// ============================================
const MONTHLY_LIMIT = 200;

export function canGenerate(user) {
  if (!user) return { allowed: false, reason: 'auth_required' };

  if (user.tier === 'pro') {
    if (user.monthly_usage >= MONTHLY_LIMIT) {
      return { allowed: false, reason: 'monthly_limit' };
    }
    return { allowed: true };
  }

  // Free tier with purchased credits
  if (user.credits > 0) {
    return { allowed: true };
  }

  return { allowed: false, reason: 'upgrade' };
}

export async function consumeCredit(user) {
  const sql = getSQL();
  if (user.tier === 'pro') {
    await sql`
      UPDATE users SET monthly_usage = monthly_usage + 1, updated_at = NOW()
      WHERE id = ${user.id}
    `;
  } else {
    await sql`
      UPDATE users SET credits = credits - 1, updated_at = NOW()
      WHERE id = ${user.id}
    `;
  }
}

// ============================================
// USER MANAGEMENT
// ============================================
export async function upsertGoogleUser({ googleId, email, name, picture }) {
  const sql = getSQL();
  const rows = await sql`
    INSERT INTO users (google_id, email, name, picture)
    VALUES (${googleId}, ${email}, ${name || ''}, ${picture || ''})
    ON CONFLICT (google_id) DO UPDATE SET
      email = EXCLUDED.email,
      name = EXCLUDED.name,
      picture = EXCLUDED.picture,
      updated_at = NOW()
    RETURNING *
  `;
  return rows[0];
}

export async function getUserById(id) {
  const sql = getSQL();
  const rows = await sql`SELECT * FROM users WHERE id = ${id}`;
  return rows[0] || null;
}

export async function getUserByEmail(email) {
  const sql = getSQL();
  const rows = await sql`SELECT * FROM users WHERE email = ${email.toLowerCase()}`;
  return rows[0] || null;
}

export async function updateUser(id, fields) {
  const sql = getSQL();
  // Build dynamic update — only supports the fields we need
  if (fields.tier !== undefined) {
    await sql`UPDATE users SET tier = ${fields.tier}, updated_at = NOW() WHERE id = ${id}`;
  }
  if (fields.stripe_customer_id !== undefined) {
    await sql`UPDATE users SET stripe_customer_id = ${fields.stripe_customer_id}, updated_at = NOW() WHERE id = ${id}`;
  }
  if (fields.stripe_subscription_id !== undefined) {
    await sql`UPDATE users SET stripe_subscription_id = ${fields.stripe_subscription_id}, updated_at = NOW() WHERE id = ${id}`;
  }
  if (fields.credits !== undefined) {
    await sql`UPDATE users SET credits = ${fields.credits}, updated_at = NOW() WHERE id = ${id}`;
  }
  if (fields.monthly_usage !== undefined) {
    await sql`UPDATE users SET monthly_usage = ${fields.monthly_usage}, updated_at = NOW() WHERE id = ${id}`;
  }
}

export async function incrementCredits(userId) {
  const sql = getSQL();
  await sql`UPDATE users SET credits = credits + 1, updated_at = NOW() WHERE id = ${userId}`;
}

export async function setProStatus(userId, stripeCustomerId, stripeSubscriptionId) {
  const sql = getSQL();
  await sql`
    UPDATE users SET
      tier = 'pro',
      stripe_customer_id = ${stripeCustomerId},
      stripe_subscription_id = ${stripeSubscriptionId},
      monthly_usage = 0,
      usage_reset_at = date_trunc('month', NOW()) + INTERVAL '1 month',
      updated_at = NOW()
    WHERE id = ${userId}
  `;
}

export async function downgradeUser(stripeSubscriptionId) {
  const sql = getSQL();
  await sql`
    UPDATE users SET
      tier = 'free',
      stripe_subscription_id = NULL,
      updated_at = NOW()
    WHERE stripe_subscription_id = ${stripeSubscriptionId}
  `;
}

export async function findUserByStripeCustomer(stripeCustomerId) {
  const sql = getSQL();
  const rows = await sql`SELECT * FROM users WHERE stripe_customer_id = ${stripeCustomerId}`;
  return rows[0] || null;
}

// ============================================
// SINGLE CREDIT (anonymous $5 purchases)
// ============================================
export async function createSingleCredit(stripeSessionId) {
  const token = crypto.randomBytes(32).toString('hex');
  const sql = getSQL();
  await sql`
    INSERT INTO single_credits (token, stripe_session_id)
    VALUES (${token}, ${stripeSessionId})
  `;
  return token;
}

export async function getSingleCredit(token) {
  if (!token || token.length !== 64) return null;
  const sql = getSQL();
  const rows = await sql`
    SELECT * FROM single_credits
    WHERE token = ${token} AND used = FALSE
  `;
  return rows[0] || null;
}

export async function consumeSingleCredit(token) {
  if (!token || token.length !== 64) return null;
  const sql = getSQL();
  const rows = await sql`
    UPDATE single_credits
    SET used = TRUE
    WHERE token = ${token} AND used = FALSE
    RETURNING *
  `;
  return rows[0] || null;
}

export function setCreditCookie(res, token) {
  const existing = res.getHeader('Set-Cookie');
  const cookie = `tg_credit=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`;
  if (existing) {
    const cookies = Array.isArray(existing) ? existing : [existing];
    res.setHeader('Set-Cookie', [...cookies, cookie]);
  } else {
    res.setHeader('Set-Cookie', cookie);
  }
}

export function clearCreditCookie(res) {
  const existing = res.getHeader('Set-Cookie');
  const cookie = 'tg_credit=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
  if (existing) {
    const cookies = Array.isArray(existing) ? existing : [existing];
    res.setHeader('Set-Cookie', [...cookies, cookie]);
  } else {
    res.setHeader('Set-Cookie', cookie);
  }
}

// ============================================
// GENERATIONS (content workspace)
// ============================================
export async function saveGeneration(userId, videoId, videoTitle, videoThumb, platforms, content) {
  const sql = getSQL();
  const rows = await sql`
    INSERT INTO generations (user_id, video_id, video_title, video_thumb, platforms, content)
    VALUES (${userId}, ${videoId}, ${videoTitle || ''}, ${videoThumb || ''}, ${platforms || []}, ${JSON.stringify(content)})
    ON CONFLICT (user_id, video_id) DO UPDATE SET
      video_title = EXCLUDED.video_title,
      video_thumb = EXCLUDED.video_thumb,
      platforms = EXCLUDED.platforms,
      content = EXCLUDED.content,
      updated_at = NOW()
    RETURNING id
  `;
  return rows[0];
}

export async function getGenerations(userId, limit = 50, offset = 0) {
  const sql = getSQL();
  const rows = await sql`
    SELECT id, video_id, video_title, video_thumb, platforms, auto_generated, created_at, updated_at
    FROM generations
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  const countRows = await sql`
    SELECT COUNT(*)::int AS total FROM generations WHERE user_id = ${userId}
  `;
  return { videos: rows, total: countRows[0].total };
}

export async function getGeneration(userId, videoId) {
  const sql = getSQL();
  const rows = await sql`
    SELECT * FROM generations
    WHERE user_id = ${userId} AND video_id = ${videoId}
  `;
  return rows[0] || null;
}

export async function deleteGeneration(userId, videoId) {
  const sql = getSQL();
  const rows = await sql`
    DELETE FROM generations
    WHERE user_id = ${userId} AND video_id = ${videoId}
    RETURNING id
  `;
  return rows.length > 0;
}

// ============================================
// USAGE REFRESH (reusable monthly reset check)
// ============================================
export async function refreshUsage(user) {
  if (user.usage_reset_at && new Date(user.usage_reset_at) <= new Date()) {
    const sql = getSQL();
    await sql`
      UPDATE users
      SET monthly_usage = 0,
          usage_reset_at = date_trunc('month', NOW()) + INTERVAL '1 month',
          updated_at = NOW()
      WHERE id = ${user.id}
    `;
    user.monthly_usage = 0;
  }
  return user;
}

// ============================================
// LINKED CHANNELS (auto-generate from channel)
// ============================================
export async function getLinkedChannel(userId) {
  const sql = getSQL();
  const rows = await sql`
    SELECT * FROM linked_channels WHERE user_id = ${userId}
  `;
  return rows[0] || null;
}

export async function createLinkedChannel(userId, url, name, formats, knownIds) {
  const sql = getSQL();
  const rows = await sql`
    INSERT INTO linked_channels (user_id, channel_url, channel_name, default_formats, known_video_ids)
    VALUES (${userId}, ${url}, ${name || ''}, ${formats}, ${knownIds})
    ON CONFLICT (user_id) DO UPDATE SET
      channel_url = EXCLUDED.channel_url,
      channel_name = EXCLUDED.channel_name,
      default_formats = EXCLUDED.default_formats,
      known_video_ids = EXCLUDED.known_video_ids,
      enabled = TRUE,
      updated_at = NOW()
    RETURNING *
  `;
  return rows[0];
}

export async function updateLinkedChannel(userId, fields) {
  const sql = getSQL();
  if (fields.default_formats !== undefined && fields.enabled !== undefined) {
    await sql`
      UPDATE linked_channels
      SET default_formats = ${fields.default_formats}, enabled = ${fields.enabled}, updated_at = NOW()
      WHERE user_id = ${userId}
    `;
  } else if (fields.default_formats !== undefined) {
    await sql`
      UPDATE linked_channels
      SET default_formats = ${fields.default_formats}, updated_at = NOW()
      WHERE user_id = ${userId}
    `;
  } else if (fields.enabled !== undefined) {
    await sql`
      UPDATE linked_channels
      SET enabled = ${fields.enabled}, updated_at = NOW()
      WHERE user_id = ${userId}
    `;
  }
}

export async function deleteLinkedChannel(userId) {
  const sql = getSQL();
  const rows = await sql`
    DELETE FROM linked_channels WHERE user_id = ${userId} RETURNING id
  `;
  return rows.length > 0;
}

export async function getAllEnabledChannels() {
  const sql = getSQL();
  return sql`
    SELECT lc.*, u.id AS uid, u.tier, u.monthly_usage, u.usage_reset_at, u.credits
    FROM linked_channels lc
    JOIN users u ON u.id = lc.user_id
    WHERE lc.enabled = TRUE AND u.tier = 'pro'
    ORDER BY lc.last_checked_at ASC NULLS FIRST
    LIMIT 50
  `;
}

export async function markChannelChecked(channelId, newKnownIds) {
  const sql = getSQL();
  await sql`
    UPDATE linked_channels
    SET last_checked_at = NOW(), known_video_ids = ${newKnownIds}, updated_at = NOW()
    WHERE id = ${channelId}
  `;
}

export async function saveAutoGeneration(userId, videoId, videoTitle, videoThumb, platforms, content) {
  const sql = getSQL();
  const rows = await sql`
    INSERT INTO generations (user_id, video_id, video_title, video_thumb, platforms, content, auto_generated)
    VALUES (${userId}, ${videoId}, ${videoTitle || ''}, ${videoThumb || ''}, ${platforms || []}, ${JSON.stringify(content)}, TRUE)
    ON CONFLICT (user_id, video_id) DO NOTHING
    RETURNING id
  `;
  return rows[0] || null;
}

export { getSQL };
