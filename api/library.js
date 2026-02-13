// api/library.js — List saved generations for the current user.

import { getSession, getGenerations } from './_db.js';

export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  const allowed = !origin || (() => { try { return new URL(origin).host === host; } catch { return false; } })();
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getSession(req);
  if (!user) return res.status(401).json({ error: 'Sign in to access your library.' });

  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);

  try {
    const result = await getGenerations(user.id, limit, offset);
    return res.status(200).json(result);
  } catch (e) {
    console.error('Library list error:', e.message);
    return res.status(500).json({ error: 'Failed to load library.' });
  }
}
