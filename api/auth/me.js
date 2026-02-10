// api/auth/me.js — Return current user info from session cookie

import { getSession } from '../_db.js';

export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  const allowed = !origin || (function () { try { return new URL(origin).host === host; } catch { return false; } })();
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.status(200).end();

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
