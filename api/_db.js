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
          carousels_used = 0,
          usage_reset_at = date_trunc('month', NOW()) + INTERVAL '1 month',
          updated_at = NOW()
      WHERE id = ${user.id}
    `;
    user.monthly_usage = 0;
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
    VALUES (${googleId}, ${email}, ${name || ''}, ${picture || ''}, 0)
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
          carousels_used = 0,
          usage_reset_at = date_trunc('month', NOW()) + INTERVAL '1 month',
          updated_at = NOW()
      WHERE id = ${user.id}
    `;
    user.monthly_usage = 0;
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

export async function getStalestNiches(limit = 1) {
  const sql = getSQL();
  // Niches that belong to a paying subscriber's audience jump the queue when
  // they haven't been mined in 24h; otherwise plain stalest-first rotation.
  return sql`
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
    LIMIT ${limit}
  `;
}

export async function getStalestNiche() {
  const rows = await getStalestNiches(1);
  return rows[0] || null;
}

export async function markNicheMined(nicheId) {
  const sql = getSQL();
  await sql`UPDATE niches SET last_mined_at = NOW() WHERE id = ${nicheId}`;
}

export function slugifyNiche(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50)
    .replace(/-+$/, '');
}

// Merge keyword lists for a niche: the fresh app's own keywords lead (they
// drive the next mine), existing ones follow, case-insensitive dedupe, capped.
// Pure — unit tested.
export function mergeKeywords(fresh, existing, cap = 12) {
  const out = [];
  const seen = new Set();
  for (const k of [...(Array.isArray(fresh) ? fresh : []), ...(Array.isArray(existing) ? existing : [])]) {
    const s = String(k || '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= cap) break;
  }
  return out;
}

export async function setNicheKeywords(slug, keywords) {
  const sql = getSQL();
  await sql`UPDATE niches SET keywords = ${keywords || []} WHERE slug = ${slug}`;
}

// Insert-or-fetch a niche row. DO UPDATE (no-op) instead of DO NOTHING so the
// RETURNING row always comes back on conflict.
export async function ensureNiche({ slug, name, keywords }) {
  const sql = getSQL();
  const rows = await sql`
    INSERT INTO niches (slug, name, keywords)
    VALUES (${slug}, ${name}, ${keywords || []})
    ON CONFLICT (slug) DO UPDATE SET
      keywords = CASE WHEN cardinality(niches.keywords) = 0 THEN EXCLUDED.keywords ELSE niches.keywords END
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

export async function getHooks({ nicheSlug, format, platform, limit = 50, offset = 0, includeCurated = false }) {
  const sql = getSQL();
  // Feed is fully public. Rows with curated:// placeholder URLs have no real
  // source video (no receipts), so they never ship to the feed — but the
  // create-page picker asks for them (includeCurated) since they're the
  // hand-written high-quality patterns.
  const cappedLimit = Math.min(limit, 100);
  const curatedOk = !!includeCurated;
  const rows = await sql`
    SELECT h.id, h.hook_template, h.hook_verbatim, h.topic, h.format, h.platform,
           h.video_url, h.video_title, h.views, h.followers, h.outlier_score,
           h.curated, h.last_verified, n.slug AS niche_slug, n.name AS niche_name
    FROM hooks h
    JOIN niches n ON n.id = h.niche_id
    WHERE n.active = TRUE
      AND (${curatedOk} OR h.video_url NOT LIKE 'curated://%')
      AND (${nicheSlug || null}::text IS NULL OR n.slug = ${nicheSlug || null})
      AND (${format || null}::text IS NULL OR h.format = ${format || null})
      AND (${platform || null}::text IS NULL OR h.platform = ${platform || null})
    ORDER BY h.curated DESC, h.outlier_score DESC, h.last_verified DESC
    LIMIT ${cappedLimit} OFFSET ${offset}
  `;
  const countRows = await sql`
    SELECT COUNT(*)::int AS total
    FROM hooks h JOIN niches n ON n.id = h.niche_id
    WHERE n.active = TRUE
      AND (${curatedOk} OR h.video_url NOT LIKE 'curated://%')
      AND (${nicheSlug || null}::text IS NULL OR n.slug = ${nicheSlug || null})
      AND (${format || null}::text IS NULL OR h.format = ${format || null})
      AND (${platform || null}::text IS NULL OR h.platform = ${platform || null})
  `;
  return { hooks: rows, total: countRows[0].total };
}

// Auto-pick for the done-for-you flow: a random hook from the niche's top
// performers (mined receipts first, curated patterns as the fallback pool).
export async function getAutoHookPool(nicheSlug, poolSize = 10) {
  const sql = getSQL();
  return sql`
    SELECT h.*, n.slug AS niche_slug
    FROM hooks h
    JOIN niches n ON n.id = h.niche_id
    WHERE n.active = TRUE AND n.slug = ${nicheSlug}
    ORDER BY h.curated DESC, h.outlier_score DESC, h.last_verified DESC
    LIMIT ${poolSize}
  `;
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
// HOOKLAB: CAROUSELS
// ============================================
// A deploy can land before its migration does (a push auto-deploys; the SQL is
// run by hand). Rather than 500 every generation until the migration catches
// up, the hero columns degrade: we write without them and log loudly.
function missingColumn(e, col) {
  const m = String(e?.message || '');
  return /does not exist/i.test(m) && m.includes(col);
}

export async function saveCarousel(userId, hookId, style, slides, caption, watermark, heroScene) {
  const sql = getSQL();
  try {
    const rows = await sql`
      INSERT INTO carousels (user_id, hook_id, style, slides, caption, watermark, hero_scene)
      VALUES (${userId}, ${hookId || null}, ${style}, ${JSON.stringify(slides)}, ${caption || ''}, ${!!watermark}, ${heroScene || ''})
      RETURNING id, created_at
    `;
    return rows[0];
  } catch (e) {
    if (!missingColumn(e, 'hero_scene')) throw e;
    console.error('carousels.hero_scene missing — RUN scripts/migrate-hero.sql. Carousels ship without cover photos until then.');
    const rows = await sql`
      INSERT INTO carousels (user_id, hook_id, style, slides, caption, watermark)
      VALUES (${userId}, ${hookId || null}, ${style}, ${JSON.stringify(slides)}, ${caption || ''}, ${!!watermark})
      RETURNING id, created_at
    `;
    return rows[0];
  }
}

// The two images are saved INDEPENDENTLY and never in one statement. A hero
// that fails must not be able to null out a background that succeeded, or vice
// versa — each is a separately-bought asset.
export async function saveCarouselBg(userId, id, bg) {
  const sql = getSQL();
  await sql`UPDATE carousels SET bg = ${bg} WHERE user_id = ${userId} AND id = ${id}`;
}

export async function saveCarouselHero(userId, id, hero) {
  const sql = getSQL();
  try {
    await sql`UPDATE carousels SET hero = ${hero} WHERE user_id = ${userId} AND id = ${id}`;
  } catch (e) {
    if (!missingColumn(e, 'hero')) throw e;
    console.error('carousels.hero missing — RUN scripts/migrate-hero.sql. Cover photos will not be cached until then.');
  }
}

export async function getCarousels(userId) {
  const sql = getSQL();
  return sql`
    SELECT id, hook_id, style, slides, caption, watermark, created_at,
           (bg IS NOT NULL) AS has_bg
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

// Autopilot subscribers: pro tier, connected to upload-post, and have a
// completed profile (profile->>'what' is the required field).
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

export async function createPost({ userId, scheduledAt, kind, style, slides, caption, accent, motifs, heroScene, platforms }) {
  const sql = getSQL();
  try {
    const rows = await sql`
      INSERT INTO posts (user_id, scheduled_at, kind, style, slides, caption, accent, motifs, hero_scene, platforms)
      VALUES (${userId}, ${scheduledAt}, ${kind}, ${style}, ${JSON.stringify(slides)},
              ${caption}, ${accent || ''}, ${JSON.stringify(motifs || [])}, ${heroScene || ''},
              ${platforms || ['tiktok', 'instagram']})
      RETURNING id
    `;
    return rows[0];
  } catch (e) {
    if (!missingColumn(e, 'hero_scene')) throw e;
    console.error('posts.hero_scene missing — RUN scripts/migrate-hero.sql. Scheduled posts ship without cover photos until then.');
    const rows = await sql`
      INSERT INTO posts (user_id, scheduled_at, kind, style, slides, caption, accent, motifs, platforms)
      VALUES (${userId}, ${scheduledAt}, ${kind}, ${style}, ${JSON.stringify(slides)},
              ${caption}, ${accent || ''}, ${JSON.stringify(motifs || [])},
              ${platforms || ['tiktok', 'instagram']})
      RETURNING id
    `;
    return rows[0];
  }
}

// Joins users only for the two columns rendering/publishing need
// (upload_post_username, profile) plus tier for a defensive re-check.
// Neither name collides with a posts column, so no shadowing risk.
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

// ============================================
// HOOKLAB: GATING
// ============================================
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

export async function addCredits(userId, n) {
  const sql = getSQL();
  await sql`UPDATE users SET credits = COALESCE(credits, 0) + ${n}, updated_at = NOW() WHERE id = ${userId}`;
}

export { getSQL };
