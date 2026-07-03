// api/mine.js — Niche research pipeline (cron + admin trigger).
//
// GET /api/mine?secret=$ADMIN_SECRET[&niche=slug][&dry=1]
// Also runs via Vercel cron (x-vercel-cron header), one niche per run
// (the one mined longest ago).
//
// Pipeline: search Shorts per keyword + seed channels -> batch video/channel
// stats -> 5x outlier filter -> Gemini hook extraction -> upsert hooks table.

import {
  getNicheBySlug, getStalestNiche, markNicheMined,
  getExistingHookUrls, refreshHookStats, upsertHook,
} from './_db.js';
import {
  computeOutlierScore, isOutlier,
  searchShorts, channelRecentShorts, getVideoStats, getChannelStats,
} from './_youtube.js';
import { fetchTranscript } from './_transcript.js';
import { callGemini } from './_shared.js';
import { HOOK_EXTRACTION_PROMPT } from './_prompts.js';

export const maxDuration = 60;

const MAX_KEYWORDS_PER_RUN = 4;
const MAX_SEED_CHANNELS_PER_RUN = 3;
const MAX_NEW_EXTRACTIONS = 10;
const MAX_TRANSCRIPT_FETCHES = 3;

function videoUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const isCron = !!req.headers['x-vercel-cron'];
  const secretOk = process.env.ADMIN_SECRET && req.query.secret === process.env.ADMIN_SECRET;
  if (!isCron && !secretOk) return res.status(401).json({ error: 'Unauthorized' });

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'YOUTUBE_API_KEY not configured' });

  const dry = req.query.dry === '1';
  const errors = [];

  try {
    const niche = req.query.niche
      ? await getNicheBySlug(req.query.niche)
      : await getStalestNiche();
    if (!niche) return res.status(404).json({ error: 'No active niche found' });

    // 1. Gather candidate videos
    const candidates = new Map(); // videoId -> {videoId, title, channelId}
    for (const keyword of (niche.keywords || []).slice(0, MAX_KEYWORDS_PER_RUN)) {
      try {
        for (const v of await searchShorts(keyword, apiKey)) candidates.set(v.videoId, v);
      } catch (e) { errors.push(`search "${keyword}": ${e.message}`); }
    }
    for (const channelId of (niche.seed_channels || []).slice(0, MAX_SEED_CHANNELS_PER_RUN)) {
      try {
        for (const v of await channelRecentShorts(channelId, apiKey)) candidates.set(v.videoId, v);
      } catch (e) { errors.push(`channel ${channelId}: ${e.message}`); }
    }

    // 2. Batch stats
    const videoIds = [...candidates.keys()];
    const vStats = await getVideoStats(videoIds, apiKey);
    const cStats = await getChannelStats(
      [...vStats.values()].map((v) => v.channelId), apiKey
    );

    // 3. Outlier filter
    const outliers = [];
    for (const [videoId, v] of vStats) {
      const followers = cStats.get(v.channelId)?.subscribers || 0;
      if (isOutlier(v.views, followers)) {
        outliers.push({
          videoId,
          url: videoUrl(videoId),
          title: v.title,
          views: v.views,
          followers,
          score: computeOutlierScore(v.views, followers),
        });
      }
    }
    outliers.sort((a, b) => b.score - a.score);

    // 4. Split into refresh (already known) vs new
    const existing = await getExistingHookUrls(outliers.map((o) => o.url));
    const fresh = outliers.filter((o) => !existing.has(o.url)).slice(0, MAX_NEW_EXTRACTIONS);
    const refresh = outliers.filter((o) => existing.has(o.url));

    // 5. Transcript enrichment for top few new outliers
    let transcriptCount = 0;
    for (const o of fresh) {
      if (transcriptCount >= MAX_TRANSCRIPT_FETCHES) break;
      try {
        o.transcript = (await fetchTranscript(o.url)).text.substring(0, 2000);
        transcriptCount++;
      } catch { /* title-only extraction is fine */ }
    }

    // 6. Gemini extraction (one batched call)
    let extracted = [];
    if (fresh.length > 0) {
      const payload = fresh.map((o, i) => ({
        i, title: o.title, views: o.views, followers: o.followers,
        ...(o.transcript ? { transcript: o.transcript } : {}),
      }));
      try {
        const result = await callGemini(HOOK_EXTRACTION_PROMPT, JSON.stringify(payload), 0.3);
        if (Array.isArray(result)) extracted = result;
        else errors.push('extraction returned non-array');
      } catch (e) { errors.push(`extraction: ${e.message}`); }
    }

    // 7. Build rows
    const VALID_FORMATS = ['talking_head', 'whiteboard', 'audio_broll', 'skit', 'other'];
    const rows = [];
    for (const ex of extracted) {
      const src = fresh[ex.i];
      if (!src || !ex.hook_template) continue;
      rows.push({
        hookTemplate: String(ex.hook_template).substring(0, 500),
        hookVerbatim: String(ex.hook_verbatim || '').substring(0, 500),
        topic: String(ex.topic || '').substring(0, 300),
        format: VALID_FORMATS.includes(ex.format) ? ex.format : 'talking_head',
        platform: 'youtube',
        videoUrl: src.url,
        videoTitle: src.title.substring(0, 500),
        views: src.views,
        followers: src.followers,
        outlierScore: src.score,
        curated: false,
      });
    }

    if (dry) {
      return res.status(200).json({
        dry: true, niche: niche.slug,
        scanned: videoIds.length, outliers: outliers.length,
        wouldRefresh: refresh.length, wouldInsert: rows, errors,
      });
    }

    // 8. Write
    let inserted = 0;
    for (const row of rows) {
      try { await upsertHook(niche.id, row); inserted++; }
      catch (e) { errors.push(`upsert ${row.videoUrl}: ${e.message}`); }
    }
    for (const o of refresh) {
      try { await refreshHookStats(o.url, o.views, o.followers, o.score); }
      catch (e) { errors.push(`refresh ${o.url}: ${e.message}`); }
    }
    await markNicheMined(niche.id);

    return res.status(200).json({
      niche: niche.slug,
      scanned: videoIds.length, outliers: outliers.length,
      inserted, refreshed: refresh.length, errors,
    });
  } catch (e) {
    console.error('mine error:', e);
    return res.status(500).json({ error: e.message, errors });
  }
}
