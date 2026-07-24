// api/mine.js — Niche research pipeline (cron + admin trigger).
//
// GET /api/mine?secret=$ADMIN_SECRET[&niche=slug][&dry=1][&fresh=1][&phase=discover]
// dry=1 re-evaluates both new and saved candidates and makes no database writes.
// fresh=1 atomically replaces one explicit niche's mined rows with accepted
// results from the current policy; historical rows are retained but hidden.
// phase=discover returns the outlier candidate list only (no transcripts, no
// writes) for scripts/local-mine.mjs, which attaches transcripts locally.
// POST /api/mine (admin) accepts those candidates back:
//   { niche, dry?, fresh?, candidates: [{url,title,views,followers,platform,transcript}] }
// Also runs via Vercel cron (Bearer CRON_SECRET), one niche per run
// (the one mined longest ago).
//
// Pipeline: search Shorts per keyword + seed channels -> batch video/channel
// stats -> absolute-reach filter -> Gemini hook extraction -> strict transcript
// grounding and quality gate -> upsert hooks table.
// Pipeline body lives in ./_miner.js so profile-save can also call it.

import { getNicheBySlug, getStalestNiches, reconcileNicheCatalogue } from './_db.js';
import {
  mineNiche, discoverCandidates, mineFromCandidates, parseSuppliedCandidates,
} from './_miner.js';
import { adminSecretOk, cronAuthOk } from './_shared.js';
import { LEGACY_NICHE_SLUGS } from './_niches.js';

export const maxDuration = 60;

// One cron fires per day; with one niche per run, N niches means each gets
// mined every N days — too stale to mean "currently viral". Batch a few
// stalest niches per run inside a time budget that leaves headroom for the
// last niche to finish within maxDuration.
const NICHES_PER_RUN = 3;
const TIME_BUDGET_MS = 35_000;

export default async function handler(req, res) {
  res.setHeader?.('Cache-Control', 'no-store');

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const action = req.query?.action || body?.action || '';

  // Uses the existing ADMIN_SECRET and the existing function slot. Preview is
  // safe over GET; production mutation is deliberately POST-only.
  if (action === 'repair-niches') {
    if (!['GET', 'POST'].includes(req.method)) {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    if (!adminSecretOk(req)) return res.status(401).json({ error: 'ADMIN_SECRET required' });
    if (req.method === 'POST' && body?.confirm !== 'REPAIR_NICHES') {
      return res.status(400).json({ error: 'POST repair requires confirm=REPAIR_NICHES' });
    }
    try {
      const result = await reconcileNicheCatalogue({ apply: req.method === 'POST' });
      return res.status(200).json(result);
    } catch (e) {
      console.error('niche repair error:', e);
      return res.status(500).json({ error: e.message });
    }
  }

  // POST /api/mine — supplied-candidate mine, used by scripts/local-mine.mjs.
  // The caller fetched transcripts on their own machine (yt-dlp captions /
  // local Whisper — free, home IP); extraction, quality gates, and all
  // database writes stay server-side. Secrets never leave Vercel.
  if (req.method === 'POST') {
    if (!adminSecretOk(req)) return res.status(401).json({ error: 'ADMIN_SECRET required' });
    const slug = String(body?.niche || '');
    if (!slug) return res.status(400).json({ error: 'niche is required' });
    if (LEGACY_NICHE_SLUGS.includes(slug)) {
      return res.status(410).json({
        error: 'That legacy niche is retired. Run action=repair-niches, then mine its canonical replacement.',
      });
    }
    try {
      const niche = await getNicheBySlug(slug);
      if (!niche) return res.status(404).json({ error: 'No active niche found' });
      const dry = body?.dry === true || body?.dry === '1' || body?.dry === 1;
      const fresh = body?.fresh === true || body?.fresh === '1' || body?.fresh === 1;
      const parsed = parseSuppliedCandidates(body?.candidates);
      if (parsed.candidates.length === 0) {
        return res.status(400).json({ error: 'No usable candidates', errors: parsed.errors });
      }
      const result = await mineFromCandidates(niche, parsed.candidates, {
        dry,
        fresh,
        transcriptPauseMs: 0,
        // Transcripts arrive pre-fetched, so nearly all of maxDuration is
        // still available — give the batched extraction real headroom instead
        // of the 20s default that a slow Gemini day blows through.
        extractionTimeoutMs: 40_000,
        errors: parsed.errors,
        // Transcripts cost the caller nothing (local yt-dlp/Whisper), so
        // evaluate a wider pool than the Supadata-priced GET path does —
        // speech-poor niches (music-recipe shorts etc.) need the depth.
        maxExtractions: 30,
        maxTranscripts: 48,
      });
      return res.status(fresh && !dry && result.applied === false ? 409 : 200).json(result);
    } catch (e) {
      console.error('mine POST error:', e);
      return res.status(500).json({ error: e.message });
    }
  }

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
      if (LEGACY_NICHE_SLUGS.includes(req.query.niche)) {
        return res.status(410).json({
          error: 'That legacy niche is retired. Run action=repair-niches, then mine its canonical replacement.',
        });
      }
      const niche = await getNicheBySlug(req.query.niche);
      if (!niche) return res.status(404).json({ error: 'No active niche found' });

      // phase=discover: return the outlier candidate list only (steps 1-3),
      // so the local mining script can attach transcripts and POST them back.
      if (req.query.phase === 'discover') {
        if (!adminSecretOk(req)) {
          return res.status(403).json({ error: 'phase=discover requires ADMIN_SECRET' });
        }
        const discovery = await discoverCandidates(niche, apiKey);
        return res.status(200).json({
          niche: niche.slug,
          scanned: discovery.scanned,
          discoveryFailures: discovery.discoveryFailures,
          outlierCount: discovery.outliers.length,
          outliers: discovery.outliers.slice(0, 40),
          errors: discovery.errors,
        });
      }

      const result = await mineNiche(niche, apiKey, {
        dry,
        fresh,
        ...(fresh ? { maxExtractions: 18, maxTranscripts: 30 } : {}),
      });
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
