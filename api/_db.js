// api/_db.js — Database + session helpers
// Vercel ignores _-prefixed files in api/ as endpoints.

import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';

function getSQL() {
  return neon(process.env.POSTGRES_URL);
}

export function monthlyUsageNeedsReset(user, now = new Date()) {
  if (!user?.usage_reset_at) return true;
  const resetAt = new Date(user.usage_reset_at).getTime();
  return !Number.isFinite(resetAt) || resetAt <= new Date(now).getTime();
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
  if (monthlyUsageNeedsReset(user)) {
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
    user.usage_reset_at = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1);
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
      carousels_used = 0,
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
  if (monthlyUsageNeedsReset(user)) {
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
    user.usage_reset_at = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1);
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
  // Rows with curated:// placeholder URLs have no real source video. The
  // create-page picker can request them as fallbacks; mined sources must meet
  // the same absolute-reach floor as the current miner.
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
      AND (h.curated = TRUE OR h.views >= 250000)
      AND (${nicheSlug || null}::text IS NULL OR n.slug = ${nicheSlug || null})
      AND (${format || null}::text IS NULL OR h.format = ${format || null})
      AND (${platform || null}::text IS NULL OR h.platform = ${platform || null})
    ORDER BY h.curated ASC, h.views DESC, h.outlier_score DESC, h.last_verified DESC
    LIMIT ${cappedLimit} OFFSET ${offset}
  `;
  const countRows = await sql`
    SELECT COUNT(*)::int AS total
    FROM hooks h JOIN niches n ON n.id = h.niche_id
    WHERE n.active = TRUE
      AND (${curatedOk} OR h.video_url NOT LIKE 'curated://%')
      AND (h.curated = TRUE OR h.views >= 250000)
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
      AND (h.curated = TRUE OR h.views >= 250000)
    ORDER BY h.curated ASC, h.views DESC, h.outlier_score DESC, h.last_verified DESC
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

function upsertHookQuery(sql, nicheId, h) {
  return sql`
    INSERT INTO hooks (niche_id, hook_template, hook_verbatim, topic, format, platform,
                       video_url, video_title, views, followers, outlier_score, curated)
    VALUES (${nicheId}, ${h.hookTemplate}, ${h.hookVerbatim || ''}, ${h.topic || ''},
            ${h.format || 'talking_head'}, ${h.platform || 'youtube'}, ${h.videoUrl},
            ${h.videoTitle || ''}, ${h.views || 0}, ${h.followers || 0},
            ${h.outlierScore || 0}, ${h.curated || false})
    ON CONFLICT (video_url) DO UPDATE SET
      hook_template = EXCLUDED.hook_template,
      hook_verbatim = EXCLUDED.hook_verbatim,
      topic = EXCLUDED.topic,
      format = EXCLUDED.format,
      platform = EXCLUDED.platform,
      video_title = EXCLUDED.video_title,
      views = EXCLUDED.views,
      followers = EXCLUDED.followers,
      outlier_score = EXCLUDED.outlier_score,
      last_verified = NOW()
    WHERE hooks.niche_id = EXCLUDED.niche_id
      AND hooks.curated = FALSE
    RETURNING id
  `;
}

export async function upsertHook(nicheId, h) {
  const sql = getSQL();
  const rows = await upsertHookQuery(sql, nicheId, h);
  return rows[0];
}

// Atomically replace one niche's YouTube-mined inventory after a full policy
// recheck. Accepted URLs are upserted first so retained rows keep their ids;
// obsolete YouTube rows are then removed. Curated and future non-YouTube rows
// are deliberately preserved. Any query failure rolls the whole transaction
// back, including the deletion.
export async function replaceMinedHooksForNiche(nicheId, hooks) {
  if (!Array.isArray(hooks) || hooks.length === 0) {
    throw new Error('Fresh rebuild produced no accepted hooks; existing hooks were kept.');
  }
  const sql = getSQL();
  const acceptedUrls = hooks.map((hook) => hook.videoUrl);
  const ownershipConflicts = await sql`
    SELECT video_url
    FROM hooks
    WHERE video_url = ANY(${acceptedUrls})
      AND (niche_id <> ${nicheId} OR curated = TRUE)
  `;
  if (ownershipConflicts.length > 0) {
    throw new Error('Fresh rebuild found source URLs owned by another niche; existing hooks were kept.');
  }
  const results = await sql.transaction((tx) => [
    tx`SELECT pg_advisory_xact_lock(87001, ${nicheId})`,
    ...hooks.map((hook) => upsertHookQuery(tx, nicheId, hook)),
    // Division by zero deliberately aborts and rolls back the transaction if a
    // concurrent mine claimed one of these globally-unique video URLs.
    tx`
      SELECT 1 / CASE WHEN COUNT(*) = ${hooks.length} THEN 1 ELSE 0 END AS ownership_complete
      FROM hooks
      WHERE niche_id = ${nicheId}
        AND curated = FALSE
        AND platform = 'youtube'
        AND video_url = ANY(${acceptedUrls})
    `,
    tx`
      DELETE FROM hooks
      WHERE niche_id = ${nicheId}
        AND curated = FALSE
        AND platform = 'youtube'
        AND NOT (video_url = ANY(${acceptedUrls}))
      RETURNING id
    `,
    tx`
      UPDATE niches
      SET last_mined_at = NOW()
      WHERE id = ${nicheId}
      RETURNING id
    `,
  ]);
  const deleteResult = results[hooks.length + 2] || [];
  return {
    removed: deleteResult.length,
    upserted: results.slice(1, hooks.length + 1)
      .reduce((count, rows) => count + (rows?.length || 0), 0),
  };
}

export async function getExistingHookUrls(urls) {
  if (!urls || urls.length === 0) return new Set();
  const sql = getSQL();
  const rows = await sql`SELECT video_url FROM hooks WHERE video_url = ANY(${urls})`;
  return new Set(rows.map((r) => r.video_url));
}

export async function getMinedHookUrlsForNiche(nicheId) {
  const sql = getSQL();
  const rows = await sql`
    SELECT video_url
    FROM hooks
    WHERE niche_id = ${nicheId}
      AND curated = FALSE
      AND platform = 'youtube'
  `;
  return new Set(rows.map((row) => row.video_url));
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

export async function updateProfileIcon(userId, expectedAppUrl, iconUrl) {
  const sql = getSQL();
  const rows = await sql`
    UPDATE users
    SET profile = COALESCE(profile, '{}'::jsonb) || jsonb_build_object(
          'icon_url', ${iconUrl || ''}::text,
          'icon_checked', TRUE
        ),
        updated_at = NOW()
    WHERE id = ${userId}
      AND profile->>'app_url' = ${expectedAppUrl}
      AND COALESCE(profile->>'icon_url', '') = ''
      AND COALESCE(profile->>'icon_checked', 'false') <> 'true'
    RETURNING profile
  `;
  return rows[0]?.profile || null;
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

// Hook ids of the user's most recent carousels — the generation variety guard.
export async function getRecentHookIds(userId, n = 5) {
  const sql = getSQL();
  const rows = await sql`
    SELECT hook_id FROM carousels
    WHERE user_id = ${userId} AND hook_id IS NOT NULL
    ORDER BY created_at DESC LIMIT ${n}
  `;
  return [...new Set(rows.map((r) => r.hook_id))];
}

let reelSchemaPromise;

export async function ensureReelSchema() {
  if (!reelSchemaPromise) {
    reelSchemaPromise = (async () => {
      const sql = getSQL();
      await sql`ALTER TABLE carousels ADD COLUMN IF NOT EXISTS reel_status VARCHAR(20)`;
      await sql`ALTER TABLE carousels ADD COLUMN IF NOT EXISTS reel_render_id VARCHAR(100)`;
      await sql`ALTER TABLE carousels ADD COLUMN IF NOT EXISTS reel_url TEXT`;
      await sql`ALTER TABLE carousels ADD COLUMN IF NOT EXISTS reel_poster_url TEXT`;
      await sql`ALTER TABLE carousels ADD COLUMN IF NOT EXISTS reel_error TEXT`;
      await sql`ALTER TABLE carousels ADD COLUMN IF NOT EXISTS reel_requested_at TIMESTAMPTZ`;
      await sql`ALTER TABLE carousels ADD COLUMN IF NOT EXISTS reel_checked_at TIMESTAMPTZ`;
      await sql`ALTER TABLE carousels ADD COLUMN IF NOT EXISTS reel_finished_at TIMESTAMPTZ`;
      await sql`ALTER TABLE carousels ADD COLUMN IF NOT EXISTS reel_url_expires_at TIMESTAMPTZ`;
    })().catch((error) => {
      reelSchemaPromise = null;
      throw error;
    });
  }
  return reelSchemaPromise;
}

export async function getCarousels(userId) {
  const sql = getSQL();
  return sql`
    SELECT id, hook_id, style, slides, caption, watermark, created_at,
           (bg IS NOT NULL) AS has_bg, reel_status, reel_url, reel_error,
           reel_requested_at, reel_finished_at, reel_url_expires_at
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

export async function getCarouselByIdForRender(id) {
  const sql = getSQL();
  const rows = await sql`
    SELECT c.*, u.profile
    FROM carousels c JOIN users u ON u.id = c.user_id
    WHERE c.id = ${id}
  `;
  return rows[0] || null;
}

export async function claimReelRender(userId, carouselId) {
  const sql = getSQL();
  const rows = await sql`
    UPDATE carousels
    SET reel_status = 'submitting', reel_render_id = NULL, reel_url = NULL,
        reel_poster_url = NULL, reel_error = '', reel_requested_at = NOW(),
        reel_checked_at = NULL, reel_finished_at = NULL, reel_url_expires_at = NULL
    WHERE user_id = ${userId} AND id = ${carouselId}
      AND (
        reel_status IS NULL
        OR reel_status IN ('failed', 'expired')
        OR reel_requested_at < NOW() - INTERVAL '30 minutes'
        OR (reel_status = 'ready' AND reel_url_expires_at <= NOW())
      )
    RETURNING id
  `;
  return rows.length > 0;
}

export async function saveReelSubmission(userId, carouselId, renderId) {
  const sql = getSQL();
  await sql`
    UPDATE carousels SET reel_status = 'rendering', reel_render_id = ${renderId},
      reel_checked_at = NOW()
    WHERE user_id = ${userId} AND id = ${carouselId} AND reel_status = 'submitting'
  `;
}

export async function saveReelState(userId, carouselId, state) {
  const sql = getSQL();
  const ready = state.status === 'ready';
  await sql`
    UPDATE carousels SET reel_status = ${state.status}, reel_error = ${state.error || ''},
      reel_url = CASE WHEN ${ready} THEN ${state.url || ''} ELSE reel_url END,
      reel_poster_url = CASE WHEN ${ready} THEN ${state.poster || ''} ELSE reel_poster_url END,
      reel_checked_at = NOW(),
      reel_finished_at = CASE WHEN ${ready || state.status === 'failed'} THEN NOW() ELSE reel_finished_at END,
      reel_url_expires_at = CASE WHEN ${ready} THEN NOW() + INTERVAL '23 hours' ELSE reel_url_expires_at END
    WHERE user_id = ${userId} AND id = ${carouselId}
  `;
}

export async function getReelState(userId, carouselId) {
  const sql = getSQL();
  const rows = await sql`
    SELECT id, reel_status, reel_render_id, reel_url, reel_error,
      reel_requested_at, reel_checked_at, reel_finished_at, reel_url_expires_at
    FROM carousels WHERE user_id = ${userId} AND id = ${carouselId}
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
    SELECT id, scheduled_at, status, kind, style, slides, caption, platforms,
           error, retries, created_at
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
    FROM posts
    WHERE user_id = ${userId}
      AND status IN ('queued', 'publishing', 'submitted', 'verifying', 'blocked')
      AND scheduled_at > NOW()
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
      SELECT ${userId}, ${scheduledAt}, ${kind}, ${style}, ${JSON.stringify(slides)},
             ${caption}, ${accent || ''}, ${JSON.stringify(motifs || [])}, ${heroScene || ''},
             ${platforms || ['tiktok', 'instagram']}
      WHERE NOT EXISTS (
        SELECT 1 FROM posts
        WHERE user_id = ${userId} AND scheduled_at = ${scheduledAt}
          AND status IN ('queued', 'publishing', 'submitted', 'verifying', 'blocked', 'posted')
      )
      RETURNING id
    `;
    return rows[0] || null;
  } catch (e) {
    if (!missingColumn(e, 'hero_scene')) throw e;
    console.error('posts.hero_scene missing — RUN scripts/migrate-hero.sql. Scheduled posts ship without cover photos until then.');
    const rows = await sql`
      INSERT INTO posts (user_id, scheduled_at, kind, style, slides, caption, accent, motifs, platforms)
      SELECT ${userId}, ${scheduledAt}, ${kind}, ${style}, ${JSON.stringify(slides)},
             ${caption}, ${accent || ''}, ${JSON.stringify(motifs || [])},
             ${platforms || ['tiktok', 'instagram']}
      WHERE NOT EXISTS (
        SELECT 1 FROM posts
        WHERE user_id = ${userId} AND scheduled_at = ${scheduledAt}
          AND status IN ('queued', 'publishing', 'submitted', 'verifying', 'blocked', 'posted')
      )
      RETURNING id
    `;
    return rows[0] || null;
  }
}

// Claims are atomic: overlapping primary/recovery/manual runs can never render
// and submit the same row at the same time. A stable provider request id then
// covers the crash window between upload-post accepting a request and this
// process recording its response.
export async function claimDuePosts(runId, limit = 5) {
  const sql = getSQL();
  return sql`
    WITH candidates AS (
      SELECT p.id
      FROM posts p
      WHERE p.status IN ('queued', 'blocked') AND p.scheduled_at <= NOW()
      ORDER BY p.scheduled_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    ), claimed AS (
      UPDATE posts p
      SET status = 'publishing', publish_claimed_at = NOW(), publish_run_id = ${runId}
      FROM candidates c
      WHERE p.id = c.id
      RETURNING p.*
    )
    SELECT claimed.*, u.upload_post_username, u.profile, u.tier
    FROM claimed JOIN users u ON u.id = claimed.user_id
    ORDER BY claimed.scheduled_at ASC
  `;
}

export async function getPostQueueSummary(userId) {
  const sql = getSQL();
  const rows = await sql`
    SELECT
      COUNT(*) FILTER (
        WHERE status IN ('queued', 'blocked') AND scheduled_at <= NOW()
      )::int AS due,
      COUNT(*) FILTER (
        WHERE status IN ('queued', 'publishing', 'submitted', 'verifying', 'blocked')
          AND scheduled_at > NOW()
      )::int AS future,
      COUNT(*) FILTER (WHERE status IN ('submitted', 'verifying'))::int AS submitted,
      COUNT(*) FILTER (WHERE status = 'blocked')::int AS blocked,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
      MIN(scheduled_at) FILTER (
        WHERE status IN ('queued', 'publishing', 'submitted', 'verifying', 'blocked')
          AND scheduled_at > NOW()
      ) AS next_at
    FROM posts
    WHERE user_id = ${userId}
  `;
  return rows[0] || { due: 0, future: 0, submitted: 0, blocked: 0, failed: 0, next_at: null };
}

export async function claimSubmittedPosts(runId, limit = 20) {
  const sql = getSQL();
  return sql`
    WITH candidates AS (
      SELECT id FROM posts
      WHERE status = 'submitted'
         OR (
           status = 'failed'
           AND external_ids->>'request_id' IS NOT NULL
           AND error ~* '^[a-z0-9_-]+: (processing|pending|queued|in[ _-]progress|submitted|running)$'
         )
      ORDER BY scheduled_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    ), claimed AS (
      UPDATE posts p
      SET status = 'verifying', publish_claimed_at = NOW(), publish_run_id = ${runId}
      FROM candidates c
      WHERE p.id = c.id
      RETURNING p.*
    )
    SELECT * FROM claimed ORDER BY scheduled_at ASC
  `;
}

export async function recoverStalePostClaims(staleMinutes = 15) {
  const sql = getSQL();
  return sql`
    UPDATE posts
    SET status = CASE WHEN status = 'verifying' THEN 'submitted' ELSE 'queued' END,
        error = CASE
          WHEN status = 'publishing' THEN 'Recovered after an interrupted publishing run; retrying safely.'
          ELSE error
        END,
        publish_claimed_at = NULL,
        publish_run_id = NULL
    WHERE status IN ('publishing', 'verifying')
      AND publish_claimed_at < NOW() - (${staleMinutes} * INTERVAL '1 minute')
    RETURNING id, status
  `;
}

export async function setPostStatus(id, status, { error = '', externalIds, retries } = {}) {
  const sql = getSQL();
  const writeExternalIds = externalIds !== undefined;
  const externalJson = writeExternalIds && externalIds !== null ? JSON.stringify(externalIds) : null;
  await sql`
    UPDATE posts SET status = ${status}, error = ${error},
      external_ids = CASE WHEN ${writeExternalIds} THEN ${externalJson}::jsonb ELSE external_ids END,
      retries = COALESCE(${retries ?? null}, retries),
      publish_claimed_at = NULL,
      publish_run_id = NULL
    WHERE id = ${id}
  `;
}

let autopilotSchemaPromise;

// A deploy and its SQL migration cannot land atomically on Vercel. Workers
// bootstrap this small idempotent schema before doing work; the checked-in
// migration remains the source of truth for fresh environments.
export async function ensureAutopilotReliabilitySchema() {
  if (!autopilotSchemaPromise) {
    autopilotSchemaPromise = (async () => {
      const sql = getSQL();
      await sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS publish_claimed_at TIMESTAMPTZ`;
      await sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS publish_run_id UUID`;
      await sql`
        CREATE TABLE IF NOT EXISTS autopilot_runs (
          id UUID PRIMARY KEY,
          job VARCHAR(20) NOT NULL,
          trigger VARCHAR(30) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'running',
          started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          finished_at TIMESTAMPTZ,
          stats JSONB NOT NULL DEFAULT '{}',
          errors JSONB NOT NULL DEFAULT '[]',
          duration_ms INTEGER
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_autopilot_runs_job_started
        ON autopilot_runs(job, started_at DESC)
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS autopilot_locks (
          job VARCHAR(40) PRIMARY KEY,
          owner UUID NOT NULL,
          locked_until TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_posts_claimed
        ON posts(status, publish_claimed_at)
        WHERE publish_claimed_at IS NOT NULL
      `;
    })().catch((e) => {
      autopilotSchemaPromise = null;
      throw e;
    });
  }
  return autopilotSchemaPromise;
}

export async function startAutopilotRun({ id, job, trigger }) {
  const sql = getSQL();
  await sql`
    INSERT INTO autopilot_runs (id, job, trigger)
    VALUES (${id}, ${job}, ${trigger})
  `;
}

export async function finishAutopilotRun(id, { status, stats, errors, durationMs }) {
  const sql = getSQL();
  await sql`
    UPDATE autopilot_runs
    SET status = ${status}, finished_at = NOW(), stats = ${JSON.stringify(stats)}::jsonb,
        errors = ${JSON.stringify(errors)}::jsonb, duration_ms = ${durationMs}
    WHERE id = ${id}
  `;
}

export async function getLatestAutopilotRuns() {
  const sql = getSQL();
  return sql`
    SELECT DISTINCT ON (job) job, trigger, status, started_at, finished_at, duration_ms
    FROM autopilot_runs
    ORDER BY job, started_at DESC
  `;
}

export async function acquireAutopilotLock(job, owner, ttlMinutes = 10) {
  const sql = getSQL();
  const rows = await sql`
    INSERT INTO autopilot_locks (job, owner, locked_until)
    VALUES (${job}, ${owner}, NOW() + (${ttlMinutes} * INTERVAL '1 minute'))
    ON CONFLICT (job) DO UPDATE
    SET owner = EXCLUDED.owner, locked_until = EXCLUDED.locked_until, updated_at = NOW()
    WHERE autopilot_locks.locked_until < NOW() OR autopilot_locks.owner = EXCLUDED.owner
    RETURNING owner
  `;
  return rows.length > 0;
}

export async function releaseAutopilotLock(job, owner) {
  const sql = getSQL();
  await sql`DELETE FROM autopilot_locks WHERE job = ${job} AND owner = ${owner}`;
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
