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
    const result = await sql`DELETE FROM sessions WHERE expires_at < NOW()`;
    const deleted = result.count || 0;
    console.log(`Cron cleanup: deleted ${deleted} expired sessions`);
    return res.status(200).json({ ok: true, deleted });
  } catch (err) {
    console.error('Cron cleanup error:', err);
    return res.status(500).json({ error: 'Cleanup failed' });
  }
}
