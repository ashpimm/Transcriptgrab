// api/auth/me.js — GET: current user info | POST: logout

import { getSession, parseCookies, clearSessionCookie, getSQL } from '../_db.js';

export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  const allowed = !origin || (function () { try { return new URL(origin).host === host; } catch { return false; } })();
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ===== POST: Logout =====
  if (req.method === 'POST') {
    try {
      const cookies = parseCookies(req);
      const token = cookies.tg_session;
      if (token && token.length === 64) {
        const sql = getSQL();
        await sql`DELETE FROM sessions WHERE id = ${token}`;
      }
      clearSessionCookie(res);
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('Logout error:', err);
      clearSessionCookie(res);
      return res.status(200).json({ ok: true });
    }
  }

  // ===== GET: Current user =====
  // Lazy cleanup: ~1 in 50 requests, delete expired sessions + old single credits
  if (Math.random() < 0.02) {
    try {
      const sql = getSQL();
      await sql`DELETE FROM sessions WHERE expires_at < NOW()`;
      await sql`DELETE FROM single_credits WHERE used = TRUE AND created_at < NOW() - INTERVAL '7 days'`;
    } catch (e) {
      // Non-fatal — just housekeeping
    }
  }

  try {
    const user = await getSession(req);

    if (!user) {
      return res.status(200).json({ user: null });
    }

    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
        tier: user.tier,
        credits: user.credits,
        monthly_usage: user.monthly_usage,
        usage_limit: user.tier === 'pro' ? 200 : 0,
      },
    });
  } catch (err) {
    console.error('Auth me error:', err);
    return res.status(200).json({ user: null });
  }
}
