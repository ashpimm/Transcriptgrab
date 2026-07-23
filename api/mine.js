// api/mine.js — Niche research pipeline (cron + admin trigger).
//
// GET /api/mine?secret=$ADMIN_SECRET[&niche=slug][&dry=1][&fresh=1]
// dry=1 re-evaluates both new and saved candidates and makes no database writes.
// fresh=1 atomically replaces one explicit niche's mined rows with accepted
// results from the current policy; curated fallbacks are preserved.
// Also runs via Vercel cron (Bearer CRON_SECRET), one niche per run
// (the one mined longest ago).
//
// Pipeline: search Shorts per keyword + seed channels -> batch video/channel
// stats -> absolute-reach filter -> Gemini hook extraction -> strict transcript
// grounding and quality gate -> upsert hooks table.
// Pipeline body lives in ./_miner.js so profile-save can also call it.

import { getNicheBySlug, getStalestNiches } from './_db.js';
import { mineNiche } from './_miner.js';
import { adminSecretOk, cronAuthOk } from './_shared.js';

export const maxDuration = 60;

// One cron fires per day; with one niche per run, N niches means each gets
// mined every N days — too stale to mean "currently viral". Batch a few
// stalest niches per run inside a time budget that leaves headroom for the
// last niche to finish within maxDuration.
const NICHES_PER_RUN = 3;
const TIME_BUDGET_MS = 35_000;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!cronAuthOk(req)) return res.status(401).json({ error: 'Unauthorized' });

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'YOUTUBE_API_KEY not configured' });

  try {
    const dry = req.query.dry === '1';
    const fresh = req.query.fresh === '1';
    if (fresh && !req.query.niche) {
      return res.status(400).json({ error: 'fresh=1 requires an explicit niche slug' });
    }
    if (fresh && !dry && !adminSecretOk(req)) {
      return res.status(403).json({ error: 'A real fresh rebuild requires ADMIN_SECRET' });
    }

    // Explicit niche: single targeted mine (admin use).
    if (req.query.niche) {
      const niche = await getNicheBySlug(req.query.niche);
      if (!niche) return res.status(404).json({ error: 'No active niche found' });
      const result = await mineNiche(niche, apiKey, { dry, fresh });
      return res.status(fresh && !dry && result.applied === false ? 409 : 200).json(result);
    }

    // Cron / no niche: sweep the stalest few within the time budget.
    const niches = await getStalestNiches(NICHES_PER_RUN);
    if (niches.length === 0) return res.status(404).json({ error: 'No active niche found' });

    const started = Date.now();
    const results = [];
    for (const niche of niches) {
      if (results.length > 0 && Date.now() - started > TIME_BUDGET_MS) break;
      try {
        results.push(await mineNiche(niche, apiKey, { dry }));
      } catch (e) {
        results.push({ niche: niche.slug, error: e.message });
      }
    }
    return res.status(200).json({ mined: results.length, results });
  } catch (e) {
    console.error('mine error:', e);
    return res.status(500).json({ error: e.message });
  }
}
