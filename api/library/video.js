// api/library/video.js — Get or delete a single saved generation.

import { getSession, getGeneration, deleteGeneration } from '../_db.js';

export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  const allowed = !origin || (() => { try { return new URL(origin).host === host; } catch { return false; } })();
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await getSession(req);
  if (!user) return res.status(401).json({ error: 'Sign in to access your library.' });

  const videoId = req.query.v;
  if (!videoId) return res.status(400).json({ error: 'Missing video ID (?v=...)' });

  try {
    if (req.method === 'GET') {
      const gen = await getGeneration(user.id, videoId);
      if (!gen) return res.status(404).json({ error: 'Video not found in library.' });
      return res.status(200).json(gen);
    }

    if (req.method === 'DELETE') {
      const deleted = await deleteGeneration(user.id, videoId);
      if (!deleted) return res.status(404).json({ error: 'Video not found in library.' });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('Library video error:', e.message);
    return res.status(500).json({ error: 'Failed to process request.' });
  }
}
