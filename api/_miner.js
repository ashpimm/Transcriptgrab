// api/_miner.js — Mining pipeline core, callable from the cron endpoint AND
// from profile-save (light mode) for freshly created audience niches.
// Vercel ignores _-prefixed files in api/ as endpoints.

import {
  markNicheMined, getExistingHookUrls, refreshHookStats, upsertHook,
} from './_db.js';
import {
  computeOutlierScore, isOutlier, isMostlyLatin,
  searchShorts, channelRecentShorts, getVideoStats, getChannelStats,
} from './_youtube.js';
import { fetchTranscript } from './_transcript.js';
import { callGemini } from './_shared.js';
import { HOOK_EXTRACTION_PROMPT } from './_prompts.js';

const VALID_FORMATS = ['talking_head', 'whiteboard', 'audio_broll', 'skit', 'other'];

function videoUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export async function mineNiche(niche, apiKey, opts = {}) {
  const {
    maxKeywords = 4, maxSeedChannels = 3,
    maxExtractions = 10, maxTranscripts = 3, dry = false,
  } = opts;
  const errors = [];

  // 1. Gather candidate videos
  const candidates = new Map(); // videoId -> {videoId, title, channelId}
  for (const keyword of (niche.keywords || []).slice(0, maxKeywords)) {
    try {
      for (const v of await searchShorts(keyword, apiKey)) candidates.set(v.videoId, v);
    } catch (e) { errors.push(`search "${keyword}": ${e.message}`); }
  }
  for (const channelId of (niche.seed_channels || []).slice(0, maxSeedChannels)) {
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
  const fresh = outliers.filter((o) => !existing.has(o.url)).slice(0, maxExtractions);
  const refresh = outliers.filter((o) => existing.has(o.url));

  // 5. Transcript enrichment for top few new outliers
  let transcriptCount = 0;
  for (const o of fresh) {
    if (transcriptCount >= maxTranscripts) break;
    try {
      o.transcript = (await fetchTranscript(o.url)).text.substring(0, 2000);
      transcriptCount++;
    } catch { /* title-only extraction is fine */ }
  }

  // 6. Gemini extraction (one batched call)
  let extracted = [];
  if (fresh.length > 0) {
    const payload = {
      niche: niche.name,
      videos: fresh.map((o, i) => ({
        i, title: o.title, views: o.views, followers: o.followers,
        ...(o.transcript ? { transcript: o.transcript } : {}),
      })),
    };
    try {
      const result = await callGemini(HOOK_EXTRACTION_PROMPT, JSON.stringify(payload), 0.3);
      if (Array.isArray(result)) extracted = result;
      else errors.push('extraction returned non-array');
    } catch (e) { errors.push(`extraction: ${e.message}`); }
  }

  // 7. Build rows
  const rows = [];
  for (const ex of extracted) {
    const src = fresh[ex.i];
    if (!src || !ex.hook_template) continue;
    // Keyword search is noisy — Gemini judges whether the video is actually
    // niche-relevant (Minecraft "builds", toy hauls etc. score high on views
    // but are useless patterns for the audience).
    if (ex.relevant === false) {
      errors.push(`skipped off-niche: ${src.url}`);
      continue;
    }
    // English-titled video can still have non-English audio — the title
    // filter in searchShorts can't catch that, so gate the extracted text too.
    if (!isMostlyLatin(ex.hook_template) || !isMostlyLatin(ex.hook_verbatim) || !isMostlyLatin(ex.topic)) {
      errors.push(`skipped non-Latin hook: ${src.url}`);
      continue;
    }
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
    return {
      dry: true, niche: niche.slug,
      scanned: videoIds.length, outliers: outliers.length,
      wouldRefresh: refresh.length, wouldInsert: rows, errors,
    };
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

  return {
    niche: niche.slug,
    scanned: videoIds.length, outliers: outliers.length,
    inserted, refreshed: refresh.length, errors,
  };
}
