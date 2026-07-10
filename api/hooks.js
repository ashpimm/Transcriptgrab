// api/hooks.js — Hook library + swipe file.
//
// GET  /api/hooks?niche=slug&format=&platform=&offset=0  -> library (tiered depth)
// GET  /api/hooks?swipe=1                                -> user's swipe file (auth)
// POST /api/hooks {action:'save'|'unsave', hookId}       -> swipe file mutation (auth)

import {
  getSession, getNiches, getHooks, getSwipeFile,
  saveToSwipeFile, removeFromSwipeFile, swipeFileCount,
} from './_db.js';

const FREE_SWIPE_CAP = 25;

function cors(req, res) {
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  const allowed = !origin || (function () { try { return new URL(origin).host === host; } catch { return false; } })();
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') { res.status(200).end(); return true; }
  return false;
}

export default async function handler(req, res) {
  if (cors(req, res)) return;

  try {
    const user = await getSession(req).catch(() => null);

    if (req.method === 'GET') {
      // Swipe file
      if (req.query.swipe === '1') {
        if (!user) return res.status(401).json({ error: 'Sign in required' });
        const saved = await getSwipeFile(user.id);
        return res.status(200).json({ hooks: saved, cap: user.tier === 'pro' ? null : FREE_SWIPE_CAP });
      }

      // Feed — fully public, same depth for everyone
      const tier = user ? user.tier : 'anon';
      const offset = parseInt(req.query.offset || '0', 10) || 0;

      const [{ hooks, total }, niches] = await Promise.all([
        getHooks({
          nicheSlug: req.query.niche || null,
          format: req.query.format || null,
          platform: req.query.platform || null,
          limit: 50,
          offset,
        }),
        getNiches(),
      ]);

      // Attach saved-state for signed-in users
      let savedIds = new Set();
      if (user) {
        savedIds = new Set((await getSwipeFile(user.id)).map((h) => h.id));
      }

      return res.status(200).json({
        hooks: hooks.map((h) => ({ ...h, saved: savedIds.has(h.id) })),
        total,
        tier,
        niches: niches.map((n) => ({ slug: n.slug, name: n.name })),
      });
    }

    if (req.method === 'POST') {
      if (!user) return res.status(401).json({ error: 'Sign in required' });

      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      const { action, hookId } = body || {};
      const id = parseInt(hookId, 10);
      if (!id) return res.status(400).json({ error: 'hookId required' });

      if (action === 'save') {
        if (user.tier !== 'pro') {
          const count = await swipeFileCount(user.id);
          if (count >= FREE_SWIPE_CAP) {
            return res.status(402).json({ error: `Free plan caps your swipe file at ${FREE_SWIPE_CAP} hooks.`, upgrade: true });
          }
        }
        await saveToSwipeFile(user.id, id);
        return res.status(200).json({ saved: true });
      }

      if (action === 'unsave') {
        await removeFromSwipeFile(user.id, id);
        return res.status(200).json({ saved: false });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('hooks error:', e);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
