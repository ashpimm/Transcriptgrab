// api/cron/cleanup.js — Daily cleanup of expired sessions

import { getSQL } from '../_db.js';

export default async function handler(req, res) {
  // Verify this is from Vercel Cron (or allow in dev)
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sql = getSQL();
    const sessionResult = await sql`DELETE FROM sessions WHERE expires_at < NOW()`;
    const sessionsDeleted = sessionResult.count || 0;

    const creditResult = await sql`DELETE FROM single_credits WHERE created_at < NOW() - INTERVAL '7 days'`;
    const creditsDeleted = creditResult.count || 0;

    console.log(`Cron cleanup: deleted ${sessionsDeleted} expired sessions, ${creditsDeleted} old single credits`);
    return res.status(200).json({ ok: true, sessions_deleted: sessionsDeleted, credits_deleted: creditsDeleted });
  } catch (err) {
    console.error('Cron cleanup error:', err);
    return res.status(500).json({ error: 'Cleanup failed' });
  }
}
