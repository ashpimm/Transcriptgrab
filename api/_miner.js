// api/_miner.js — Mining pipeline core, callable from the cron endpoint AND
// from profile-save (light mode) for freshly created audience niches.
// Vercel ignores _-prefixed files in api/ as endpoints.

import {
  markNicheMined, getExistingHookUrls, refreshHookStats, upsertHook,
} from './_db.js';
import {
  computeOutlierScore, isHighReachCandidate, compareCandidateReach, isMostlyLatin,
  searchShorts, channelRecentShorts, getVideoStats, getChannelStats,
} from './_youtube.js';
import { fetchTranscript } from './_transcript.js';
import { callGemini } from './_shared.js';
import { HOOK_EXTRACTION_PROMPT } from './_prompts.js';

const VALID_FORMATS = ['talking_head', 'whiteboard', 'audio_broll', 'skit', 'other'];

function videoUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function normalizedWords(text) {
  return (String(text || '').toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?/gu) || [])
    .map((word) => word.replaceAll('’', "'"));
}

function containsContiguousWords(haystack, needle, maxStart = Infinity) {
  if (needle.length === 0 || haystack.length < needle.length) return false;
  const lastStart = Math.min(haystack.length - needle.length, maxStart);
  for (let start = 0; start <= lastStart; start++) {
    let matches = true;
    for (let i = 0; i < needle.length; i++) {
      if (haystack[start + i] !== needle[i]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

function containsWordsInOrder(haystack, needle) {
  let matched = 0;
  for (const word of haystack) {
    if (word === needle[matched]) matched++;
    if (matched === needle.length) return true;
  }
  return needle.length === 0;
}

// Deterministic second gate after model extraction. It prevents a plausible
// YouTube title from being published as a spoken hook unless the same words
// are actually grounded near the start of the transcript.
export function validateHookExtraction(ex, transcript) {
  if (!ex || ex.relevant !== true) return { ok: false, reason: 'off-niche' };
  if (String(ex.language || '').toLowerCase() !== 'en') return { ok: false, reason: 'non-English' };
  if (ex.transferable !== true) return { ok: false, reason: 'not transferable' };
  if (ex.is_ad !== false) return { ok: false, reason: 'advertising or promotion' };
  if (!Number.isInteger(Number(ex.quality_score)) || Number(ex.quality_score) < 4) {
    return { ok: false, reason: 'weak opening' };
  }

  const verbatim = String(ex.hook_verbatim || '').trim();
  const template = String(ex.hook_template || '').trim();
  const topic = String(ex.topic || '').trim();
  const hookWords = normalizedWords(verbatim);
  const templateParts = template.split(/\s+/).filter(Boolean);
  const slots = template.match(/___/g) || [];
  const fixedTemplateWords = normalizedWords(template.replaceAll('___', ' '));
  if (verbatim.length < 12 || hookWords.length < 4 || hookWords.length > 30) {
    return { ok: false, reason: 'bad hook length' };
  }
  if (
    template.length < 10 || templateParts.length < 5 || templateParts.length > 20 ||
    slots.length < 1 || slots.length > 4 || fixedTemplateWords.length < 4
  ) {
    return { ok: false, reason: 'bad template length' };
  }
  if (!topic || normalizedWords(topic).length < 2) return { ok: false, reason: 'missing topic' };
  if (!containsWordsInOrder(hookWords, fixedTemplateWords)) {
    return { ok: false, reason: 'template not derived from hook' };
  }

  const transcriptWords = normalizedWords(transcript).slice(0, 100);
  if (!containsContiguousWords(transcriptWords, hookWords, 25)) {
    return { ok: false, reason: 'not grounded in opening transcript' };
  }
  return { ok: true, reason: '' };
}

export async function mineNiche(niche, apiKey, opts = {}) {
  const {
    maxKeywords = 6, maxSeedChannels = 3,
    maxExtractions = 12, maxTranscripts = 18, dry = false,
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

  // 3. Reach filter. Subscriber ratio is recorded as secondary context but a
  // large creator's genuinely popular post is no longer thrown away.
  const outliers = [];
  for (const [videoId, v] of vStats) {
    const followers = cStats.get(v.channelId)?.subscribers || 0;
    if (isHighReachCandidate(v.views)) {
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
  outliers.sort(compareCandidateReach);

  // 4. Split into refresh (already known) vs new. A dry run deliberately
  // rechecks both groups so a policy change can be judged against the current
  // catalogue without writing to it.
  const existing = await getExistingHookUrls(outliers.map((o) => o.url));
  const newOutliers = outliers.filter((o) => !existing.has(o.url));
  const refresh = outliers.filter((o) => existing.has(o.url));
  const researchPool = dry ? outliers : newOutliers;

  // 5. Transcript gate: a hook is something a person SAYS — no transcript, no
  // hook. Title-only extraction shipped SEO titles as "hooks" (a 5-second
  // silent short's title is not a hook). Walk candidates best-score-first,
  // keep only those with real spoken words, cap the Supadata spend.
  const fresh = [];
  let transcriptAttempts = 0;
  for (const o of researchPool) {
    if (fresh.length >= maxExtractions || transcriptAttempts >= maxTranscripts) break;
    transcriptAttempts++;
    try {
      const text = (await fetchTranscript(o.url)).text.substring(0, 2000);
      if (normalizedWords(text).length >= 8) {
        o.transcript = text;
        fresh.push(o);
      }
    } catch { /* no captions -> not eligible */ }
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
      const result = await callGemini(HOOK_EXTRACTION_PROMPT, JSON.stringify(payload), 0.1);
      if (Array.isArray(result)) extracted = result;
      else errors.push('extraction returned non-array');
    } catch (e) { errors.push(`extraction: ${e.message}`); }
  }

  // 7. Build rows
  const rows = [];
  const seenExtractionIndexes = new Set();
  for (const ex of extracted) {
    if (!Number.isInteger(ex?.i) || seenExtractionIndexes.has(ex.i)) {
      errors.push('skipped malformed or duplicate extraction index');
      continue;
    }
    seenExtractionIndexes.add(ex.i);
    const src = fresh[ex.i];
    if (!src) continue;
    const validation = validateHookExtraction(ex, src.transcript);
    if (!validation.ok) {
      errors.push(`skipped ${validation.reason}: ${src.url}`);
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
    const wouldInsert = rows.filter((row) => !existing.has(row.videoUrl));
    const wouldReplace = rows.filter((row) => existing.has(row.videoUrl));
    return {
      dry: true, niche: niche.slug,
      scanned: videoIds.length, outliers: outliers.length,
      transcriptAttempts, transcriptEligible: fresh.length,
      accepted: rows.length, rejected: Math.max(0, fresh.length - rows.length),
      wouldRefresh: refresh.length, wouldInsert, wouldReplace, errors,
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
