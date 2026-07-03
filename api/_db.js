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
          packs_used = 0,
          carousels_used = 0,
          usage_reset_at = date_trunc('month', NOW()) + INTERVAL '1 month',
          updated_at = NOW()
      WHERE id = ${user.id}
    `;
    user.monthly_usage = 0;
    user.packs_used = 0;
    user.carousels_used = 0;
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
// USER MANAGEMENT
// ============================================
export async function upsertGoogleUser({ googleId, email, name, picture }) {
  const sql = getSQL();
  const rows = await sql`
    INSERT INTO users (google_id, email, name, picture, credits)
    VALUES (${googleId}, ${email}, ${name || ''}, ${picture || ''}, 3)
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
// CHECKOUT IDEMPOTENCY
// ============================================
export async function claimCheckoutSession(stripeSessionId, userId) {
  const sql = getSQL();
  const rows = await sql`
    INSERT INTO processed_checkouts (stripe_session_id, user_id)
    VALUES (${stripeSessionId}, ${userId})
    ON CONFLICT (stripe_session_id) DO NOTHING
    RETURNING *
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
          packs_used = 0,
          carousels_used = 0,
          usage_reset_at = date_trunc('month', NOW()) + INTERVAL '1 month',
          updated_at = NOW()
      WHERE id = ${user.id}
    `;
    user.monthly_usage = 0;
    user.packs_used = 0;
    user.carousels_used = 0;
  }
  return user;
}

// ============================================
// HOOKLAB: NICHES & HOOKS
// ============================================
export async function getNiches() {
  const sql = getSQL();
  return sql`
    SELECT id, slug, name, keywords, last_mined_at
    FROM niches WHERE active = TRUE ORDER BY name
  `;
}

export async function getNicheBySlug(slug) {
  const sql = getSQL();
  const rows = await sql`SELECT * FROM niches WHERE slug = ${slug} AND active = TRUE`;
  return rows[0] || null;
}

export async function getStalestNiche() {
  const sql = getSQL();
  const rows = await sql`
    SELECT * FROM niches WHERE active = TRUE
    ORDER BY last_mined_at ASC NULLS FIRST LIMIT 1
  `;
  return rows[0] || null;
}

export async function markNicheMined(nicheId) {
  const sql = getSQL();
  await sql`UPDATE niches SET last_mined_at = NOW() WHERE id = ${nicheId}`;
}

export async function getHooks({ nicheSlug, format, platform, limit = 50, offset = 0, freeTier = false }) {
  const sql = getSQL();
  const cappedLimit = freeTier ? Math.min(limit, 20) : Math.min(limit, 100);
  const cappedOffset = freeTier ? 0 : offset;
  const rows = await sql`
    SELECT h.id, h.hook_template, h.hook_verbatim, h.topic, h.format, h.platform,
           h.video_url, h.video_title, h.views, h.followers, h.outlier_score,
           h.curated, h.last_verified, n.slug AS niche_slug, n.name AS niche_name
    FROM hooks h
    JOIN niches n ON n.id = h.niche_id
    WHERE n.active = TRUE
      AND (${nicheSlug || null}::text IS NULL OR n.slug = ${nicheSlug || null})
      AND (${format || null}::text IS NULL OR h.format = ${format || null})
      AND (${platform || null}::text IS NULL OR h.platform = ${platform || null})
    ORDER BY h.outlier_score DESC, h.last_verified DESC
    LIMIT ${cappedLimit} OFFSET ${cappedOffset}
  `;
  const countRows = await sql`
    SELECT COUNT(*)::int AS total
    FROM hooks h JOIN niches n ON n.id = h.niche_id
    WHERE n.active = TRUE
      AND (${nicheSlug || null}::text IS NULL OR n.slug = ${nicheSlug || null})
      AND (${format || null}::text IS NULL OR h.format = ${format || null})
      AND (${platform || null}::text IS NULL OR h.platform = ${platform || null})
  `;
  return { hooks: rows, total: countRows[0].total };
}

export async function getHooksByIds(ids) {
  if (!ids || ids.length === 0) return [];
  const sql = getSQL();
  return sql`
    SELECT h.*, n.slug AS niche_slug FROM hooks h
    JOIN niches n ON n.id = h.niche_id
    WHERE h.id = ANY(${ids})
  `;
}

export async function upsertHook(nicheId, h) {
  const sql = getSQL();
  const rows = await sql`
    INSERT INTO hooks (niche_id, hook_template, hook_verbatim, topic, format, platform,
                       video_url, video_title, views, followers, outlier_score, curated)
    VALUES (${nicheId}, ${h.hookTemplate}, ${h.hookVerbatim || ''}, ${h.topic || ''},
            ${h.format || 'talking_head'}, ${h.platform || 'youtube'}, ${h.videoUrl},
            ${h.videoTitle || ''}, ${h.views || 0}, ${h.followers || 0},
            ${h.outlierScore || 0}, ${h.curated || false})
    ON CONFLICT (video_url) DO UPDATE SET
      views = EXCLUDED.views,
      followers = EXCLUDED.followers,
      outlier_score = EXCLUDED.outlier_score,
      last_verified = NOW()
    RETURNING id
  `;
  return rows[0];
}

export async function getExistingHookUrls(urls) {
  if (!urls || urls.length === 0) return new Set();
  const sql = getSQL();
  const rows = await sql`SELECT video_url FROM hooks WHERE video_url = ANY(${urls})`;
  return new Set(rows.map((r) => r.video_url));
}

export async function refreshHookStats(videoUrl, views, followers, outlierScore) {
  const sql = getSQL();
  await sql`
    UPDATE hooks
    SET views = ${views}, followers = ${followers},
        outlier_score = ${outlierScore}, last_verified = NOW()
    WHERE video_url = ${videoUrl}
  `;
}

// ============================================
// HOOKLAB: SWIPE FILE
// ============================================
export async function getSwipeFile(userId) {
  const sql = getSQL();
  return sql`
    SELECT h.id, h.hook_template, h.hook_verbatim, h.topic, h.format, h.platform,
           h.video_url, h.views, h.followers, h.outlier_score,
           n.slug AS niche_slug, n.name AS niche_name, sf.created_at AS saved_at
    FROM swipe_file sf
    JOIN hooks h ON h.id = sf.hook_id
    JOIN niches n ON n.id = h.niche_id
    WHERE sf.user_id = ${userId}
    ORDER BY sf.created_at DESC
  `;
}

export async function saveToSwipeFile(userId, hookId) {
  const sql = getSQL();
  await sql`
    INSERT INTO swipe_file (user_id, hook_id)
    VALUES (${userId}, ${hookId})
    ON CONFLICT (user_id, hook_id) DO NOTHING
  `;
}

export async function removeFromSwipeFile(userId, hookId) {
  const sql = getSQL();
  await sql`DELETE FROM swipe_file WHERE user_id = ${userId} AND hook_id = ${hookId}`;
}

export async function swipeFileCount(userId) {
  const sql = getSQL();
  const rows = await sql`SELECT COUNT(*)::int AS n FROM swipe_file WHERE user_id = ${userId}`;
  return rows[0].n;
}

// ============================================
// HOOKLAB: BUSINESS PROFILE
// ============================================
export async function getProfile(userId) {
  const sql = getSQL();
  const rows = await sql`SELECT profile FROM users WHERE id = ${userId}`;
  return rows[0]?.profile || null;
}

export async function saveProfile(userId, profileObj) {
  const sql = getSQL();
  await sql`
    UPDATE users SET profile = ${JSON.stringify(profileObj)}, updated_at = NOW()
    WHERE id = ${userId}
  `;
}

// ============================================
// HOOKLAB: SCRIPT PACKS & CAROUSELS
// ============================================
export async function saveScriptPack(userId, nicheId, title, scripts, sample) {
  const sql = getSQL();
  const rows = await sql`
    INSERT INTO script_packs (user_id, niche_id, title, scripts, sample)
    VALUES (${userId}, ${nicheId || null}, ${title || ''}, ${JSON.stringify(scripts)}, ${!!sample})
    RETURNING id, created_at
  `;
  return rows[0];
}

export async function getScriptPacks(userId) {
  const sql = getSQL();
  return sql`
    SELECT id, niche_id, title, sample, created_at,
           jsonb_array_length(scripts) AS script_count
    FROM script_packs WHERE user_id = ${userId}
    ORDER BY created_at DESC LIMIT 50
  `;
}

export async function getScriptPack(userId, id) {
  const sql = getSQL();
  const rows = await sql`
    SELECT * FROM script_packs WHERE user_id = ${userId} AND id = ${id}
  `;
  return rows[0] || null;
}

export async function updateScriptPack(userId, id, scripts) {
  const sql = getSQL();
  await sql`
    UPDATE script_packs SET scripts = ${JSON.stringify(scripts)}
    WHERE user_id = ${userId} AND id = ${id}
  `;
}

export async function saveCarousel(userId, hookId, style, slides, caption) {
  const sql = getSQL();
  const rows = await sql`
    INSERT INTO carousels (user_id, hook_id, style, slides, caption)
    VALUES (${userId}, ${hookId || null}, ${style}, ${JSON.stringify(slides)}, ${caption || ''})
    RETURNING id, created_at
  `;
  return rows[0];
}

export async function getCarousels(userId) {
  const sql = getSQL();
  return sql`
    SELECT id, hook_id, style, slides, caption, created_at
    FROM carousels WHERE user_id = ${userId}
    ORDER BY created_at DESC LIMIT 50
  `;
}

export async function getCarousel(userId, id) {
  const sql = getSQL();
  const rows = await sql`
    SELECT * FROM carousels WHERE user_id = ${userId} AND id = ${id}
  `;
  return rows[0] || null;
}

// ============================================
// HOOKLAB: GATING
// ============================================
const PACKS_PER_MONTH = 10;
const CAROUSELS_PER_MONTH = 30;

export function canGeneratePack(user, size) {
  if (!user) return { allowed: false, reason: 'auth_required' };
  if (user.tier === 'pro') {
    if ((user.packs_used || 0) >= PACKS_PER_MONTH) {
      return { allowed: false, reason: 'monthly_limit' };
    }
    return { allowed: true };
  }
  // Free tier: one 3-script sample pack, ever
  if (size === 3 && !user.sample_pack_used) {
    return { allowed: true, sample: true };
  }
  return { allowed: false, reason: 'upgrade' };
}

export function canGenerateCarousel(user) {
  if (!user) return { allowed: false, reason: 'auth_required' };
  if (user.tier !== 'pro') return { allowed: false, reason: 'upgrade' };
  if ((user.carousels_used || 0) >= CAROUSELS_PER_MONTH) {
    return { allowed: false, reason: 'monthly_limit' };
  }
  return { allowed: true };
}

export async function consumePack(user, isSample) {
  const sql = getSQL();
  if (isSample) {
    await sql`UPDATE users SET sample_pack_used = TRUE, updated_at = NOW() WHERE id = ${user.id}`;
  } else {
    await sql`UPDATE users SET packs_used = packs_used + 1, updated_at = NOW() WHERE id = ${user.id}`;
  }
}

export async function consumeCarousel(user) {
  const sql = getSQL();
  await sql`UPDATE users SET carousels_used = carousels_used + 1, updated_at = NOW() WHERE id = ${user.id}`;
}

export { getSQL };
