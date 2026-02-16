// api/auth/me.js — Return current user info from session cookie

import { getSession, getLinkedChannel, getSQL } from '../_db.js';

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

    // Fetch linked channel for Pro users
    let linked_channel = null;
    if (user.tier === 'pro') {
      try {
        const ch = await getLinkedChannel(user.id);
        if (ch) {
          linked_channel = {
            channel_url: ch.channel_url,
            channel_name: ch.channel_name,
            default_formats: ch.default_formats,
            enabled: ch.enabled,
            video_count: ch.known_video_ids?.length || 0,
          };
        }
      } catch (e) {
        console.error('Linked channel fetch error:', e.message);
      }
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
        linked_channel,
      },
    });
  } catch (err) {
    console.error('Auth me error:', err);
    return res.status(200).json({ user: null });
  }
}
