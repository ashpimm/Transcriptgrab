// api/library.js — List, get, or delete saved generations.
// GET /api/library         → list all (no content blob)
// GET /api/library?v=ID    → get single video with full content
// DELETE /api/library?v=ID → delete a saved video

import { getSession, getGenerations, getGeneration, deleteGeneration, getGenerationById, deleteGenerationById } from './_db.js';

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
  const genId = req.query.id;

  try {
    // Single item by generation PK (when ?id= is present)
    if (genId) {
      const id = parseInt(genId, 10);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid generation ID.' });

      if (req.method === 'GET') {
        const gen = await getGenerationById(user.id, id);
        if (!gen) return res.status(404).json({ error: 'Video not found in library.' });
        return res.status(200).json(gen);
      }
      if (req.method === 'DELETE') {
        const deleted = await deleteGenerationById(user.id, id);
        if (!deleted) return res.status(404).json({ error: 'Video not found in library.' });
        return res.status(200).json({ ok: true });
      }
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Single video by video_id (legacy ?v= param)
    if (videoId) {
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
    }

    // List all videos (no ?v= param)
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const result = await getGenerations(user.id, limit, offset);
    return res.status(200).json(result);

  } catch (e) {
    console.error('Library error:', e.message);
    return res.status(500).json({ error: 'Failed to process request.' });
  }
}
