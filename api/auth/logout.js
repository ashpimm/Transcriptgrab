// api/auth/logout.js — Sign out, delete session, clear cookie

import { parseCookies, clearSessionCookie, getSQL } from '../_db.js';

export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  const allowed = !origin || (function () { try { return new URL(origin).host === host; } catch { return false; } })();
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
