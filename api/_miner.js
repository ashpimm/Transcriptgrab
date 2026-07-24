// api/_miner.js — Mining pipeline core, callable from the cron endpoint AND
// from profile-save (light mode) for freshly created audience niches.
// Vercel ignores _-prefixed files in api/ as endpoints.

import {
  getExistingHookUrls, getMinedHookUrlsForNiche, getOwnedHookUrlsForNiche,
  applyIncrementalMine, replaceMinedHooksForNiche,
} from './_db.js';
import {
  computeOutlierScore, isHighReachCandidate, compareCandidateReach, isMostlyLatin,
  searchShorts, channelRecentShorts, getVideoStats, getChannelStats,
} from './_youtube.js';
import { fetchTranscript } from './_transcript.js';
import { callGemini } from './_shared.js';
import { HOOK_EXTRACTION_PROMPT } from './_prompts.js';

const VALID_FORMATS = ['talking_head', 'whiteboard', 'audio_broll', 'skit', 'other'];
export const MIN_FRESH_ACCEPTED_HOOKS = 8;
export const MIN_FRESH_TRANSCRIPT_ELIGIBLE = 12;

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

export function selectResearchPool(candidates, existingUrls, { dry = false, fresh = false } = {}) {
  if (dry || fresh) return candidates;
  return candidates.filter((candidate) => !existingUrls.has(candidate.url));
}

export function assessFreshReadiness({
  accepted = 0,
  transcriptEligible = 0,
  evaluated = 0,
  discoveryFailures = 0,
  upstreamFailures = 0,
} = {}) {
  const blockers = [];
  if (discoveryFailures > 0) blockers.push('one or more discovery searches failed');
  if (upstreamFailures > 0) blockers.push('one or more transcript or extraction services failed');
  if (transcriptEligible < MIN_FRESH_TRANSCRIPT_ELIGIBLE) {
    blockers.push(`fewer than ${MIN_FRESH_TRANSCRIPT_ELIGIBLE} candidates had usable transcripts`);
  }
  if (evaluated !== transcriptEligible) blockers.push('the extraction model did not evaluate every transcript');
  if (accepted < MIN_FRESH_ACCEPTED_HOOKS) {
    blockers.push(`fewer than ${MIN_FRESH_ACCEPTED_HOOKS} hooks passed the quality gate`);
  }
  return { canApply: blockers.length === 0, blockers };
}

export function excludeCrossNicheRows(rows, allExistingUrls, currentNicheUrls) {
  const conflicts = rows
    .filter((row) => allExistingUrls.has(row.videoUrl) && !currentNicheUrls.has(row.videoUrl))
    .map((row) => row.videoUrl);
  const conflictSet = new Set(conflicts);
  return {
    rows: rows.filter((row) => !conflictSet.has(row.videoUrl)),
    conflicts: [...conflictSet],
  };
}

export const VALID_PLATFORMS = ['youtube', 'tiktok'];
export const MAX_SUPPLIED_CANDIDATES = 60;

// Transcript failures that reflect the video (or the caller's payload), not a
// broken upstream service — these must not count toward upstreamFailures and
// block a fresh rebuild.
const NON_UPSTREAM_TRANSCRIPT_ERRORS = new Set([
  'No captions available.',
  'No transcript supplied.',
]);

const SUPPLIED_URL_HOSTS = /^(?:www\.|m\.|vm\.|vt\.)?(?:youtube\.com|youtu\.be|tiktok\.com)$/;

// Sanitize candidates supplied by the local mining script (POST /api/mine).
// Reach and outlier score are re-derived server-side, never trusted.
export function parseSuppliedCandidates(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { candidates: [], errors: ['candidates must be a non-empty array'] };
  }
  if (raw.length > MAX_SUPPLIED_CANDIDATES) {
    return { candidates: [], errors: [`too many candidates (max ${MAX_SUPPLIED_CANDIDATES})`] };
  }

  const errors = [];
  const candidates = [];
  const seenUrls = new Set();
  for (const [index, item] of raw.entries()) {
    const label = `candidate ${index}`;
    const url = typeof item?.url === 'string' ? item.url.trim() : '';
    let host = '';
    try { host = new URL(url).hostname.toLowerCase(); } catch { /* rejected below */ }
    if (!url.startsWith('https://') || !SUPPLIED_URL_HOSTS.test(host)) {
      errors.push(`${label}: url must be a YouTube or TikTok https URL`);
      continue;
    }
    if (seenUrls.has(url)) {
      errors.push(`${label}: duplicate url ${url}`);
      continue;
    }
    const title = typeof item?.title === 'string' ? item.title.trim() : '';
    if (!title) {
      errors.push(`${label}: missing title`);
      continue;
    }
    const views = Math.floor(Number(item?.views));
    if (!Number.isFinite(views) || views < 0) {
      errors.push(`${label}: views must be a non-negative number`);
      continue;
    }
    if (!isHighReachCandidate(views)) {
      errors.push(`${label}: below reach threshold (${views} views): ${url}`);
      continue;
    }
    const rawFollowers = Math.floor(Number(item?.followers));
    const followers = Number.isFinite(rawFollowers) && rawFollowers > 0 ? rawFollowers : 0;
    seenUrls.add(url);
    candidates.push({
      url,
      title: title.substring(0, 500),
      views,
      followers,
      platform: VALID_PLATFORMS.includes(item?.platform) ? item.platform : 'youtube',
      score: computeOutlierScore(views, followers),
      transcript: typeof item?.transcript === 'string' ? item.transcript : '',
    });
  }
  candidates.sort(compareCandidateReach);
  return { candidates, errors };
}

// Steps 1-3 of the pipeline: discovery, stats, reach filter. Split out so the
// local mining script can fetch this candidate list, attach transcripts on the
// user's machine (home IP — free caption/Whisper access clouds don't get), and
// POST them back for extraction.
export async function discoverCandidates(niche, apiKey, {
  maxKeywords = 6, maxSeedChannels = 3,
} = {}) {
  const errors = [];
  let discoveryFailures = 0;

  // 1. Gather candidate videos
  const candidates = new Map(); // videoId -> {videoId, title, channelId}
  const discovery = [
    ...(niche.keywords || []).slice(0, maxKeywords).map((keyword) => ({
      label: `search "${keyword}"`,
      run: () => searchShorts(keyword, apiKey),
    })),
    ...(niche.seed_channels || []).slice(0, maxSeedChannels).map((channelId) => ({
      label: `channel ${channelId}`,
      run: () => channelRecentShorts(channelId, apiKey),
    })),
  ];
  const discoveryResults = await Promise.all(discovery.map(async (source) => {
    try {
      return { source, videos: await source.run(), error: null };
    } catch (error) {
      return { source, videos: [], error };
    }
  }));
  for (const result of discoveryResults) {
    if (result.error) {
      discoveryFailures++;
      errors.push(`${result.source.label}: ${result.error.message}`);
      continue;
    }
    for (const video of result.videos) {
      candidates.set(video.videoId, video);
    }
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

  return { scanned: videoIds.length, outliers, discoveryFailures, errors };
}

// Steps 4-8: refresh split, transcript gate, extraction, validation, write.
// Transcripts come from opts.transcriptProvider (Supadata via mineNiche) or,
// when absent, from a `transcript` field already attached to each candidate
// (the local mining path).
export async function mineFromCandidates(niche, outliers, opts = {}) {
  const {
    maxExtractions = 12, maxTranscripts = 18, dry = false, fresh = false,
    scanned = outliers.length,
    discoveryFailures = 0,
    transcriptProvider = null,
    transcriptPauseMs = 300,
    extractionTimeoutMs,
    errors: priorErrors = [],
  } = opts;
  const errors = [...priorErrors];
  let upstreamFailures = 0;

  // 4. Split into refresh (already known) vs new. Dry and fresh rebuilds
  // deliberately recheck both groups under the current extraction policy.
  const existing = await getExistingHookUrls(outliers.map((o) => o.url));
  const currentMined = (dry || fresh)
    ? await getMinedHookUrlsForNiche(niche.id)
    : new Set();
  const currentOwned = (dry || fresh)
    ? await getOwnedHookUrlsForNiche(niche.id)
    : new Set();
  const refresh = outliers.filter((o) => existing.has(o.url));
  const researchPool = selectResearchPool(outliers, existing, { dry, fresh });

  // 5. Transcript gate: a hook is something a person SAYS — no transcript, no
  // hook. Title-only extraction shipped SEO titles as "hooks" (a 5-second
  // silent short's title is not a hook). Walk candidates best-score-first,
  // keep only those with real spoken words, cap the transcript spend.
  const getTranscript = transcriptProvider || (async (candidate) => {
    if (!String(candidate.transcript || '').trim()) throw new Error('No transcript supplied.');
    return candidate.transcript;
  });
  const transcriptReady = [];
  let transcriptAttempts = 0;
  let transcriptFailures = 0;
  const transcriptCandidates = researchPool.slice(0, maxTranscripts);
  // Keep the burst small and paced. Supadata's rate limit 429s a wide fan-out;
  // fetchTranscript already retries a single 429 with backoff, and pausing
  // between batches keeps the whole pass under the per-second ceiling. The
  // attached-transcript path passes transcriptPauseMs: 0 — nothing remote.
  const TRANSCRIPT_CONCURRENCY = 2;
  for (let start = 0; start < transcriptCandidates.length; start += TRANSCRIPT_CONCURRENCY) {
    if (transcriptReady.length >= maxExtractions) break;
    if (start > 0 && transcriptPauseMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, transcriptPauseMs));
    }
    const batch = transcriptCandidates.slice(start, start + TRANSCRIPT_CONCURRENCY);
    transcriptAttempts += batch.length;
    const batchResults = await Promise.all(batch.map(async (candidate) => {
      try {
        const text = String(await getTranscript(candidate)).substring(0, 2000);
        return { candidate, text, error: null };
      } catch (error) {
        return { candidate, text: '', error };
      }
    }));
    for (const result of batchResults) {
      if (result.error) {
        transcriptFailures++;
        if (!NON_UPSTREAM_TRANSCRIPT_ERRORS.has(result.error.message)) upstreamFailures++;
        errors.push(`transcript ${result.candidate.url}: ${result.error.message}`);
      } else if (
        transcriptReady.length < maxExtractions &&
        normalizedWords(result.text).length >= 8
      ) {
        result.candidate.transcript = result.text;
        transcriptReady.push(result.candidate);
      }
    }
  }

  // 6. Gemini extraction (one batched call)
  let extracted = [];
  if (transcriptReady.length > 0) {
    const payload = {
      niche: niche.name,
      videos: transcriptReady.map((o, i) => ({
        i, title: o.title, views: o.views, followers: o.followers,
        ...(o.transcript ? { transcript: o.transcript } : {}),
      })),
    };
    try {
      const result = await callGemini(
        HOOK_EXTRACTION_PROMPT, JSON.stringify(payload), 0.1,
        extractionTimeoutMs ? { timeoutMs: extractionTimeoutMs } : {},
      );
      if (Array.isArray(result)) extracted = result;
      else {
        upstreamFailures++;
        errors.push('extraction returned non-array');
      }
    } catch (e) {
      upstreamFailures++;
      errors.push(`extraction: ${e.message}`);
    }
  }

  // 7. Build rows
  const rows = [];
  const seenExtractionIndexes = new Set();
  for (const ex of extracted) {
    if (!Number.isInteger(ex?.i) || seenExtractionIndexes.has(ex.i)) {
      errors.push('skipped malformed or duplicate extraction index');
      continue;
    }
    const src = transcriptReady[ex.i];
    if (!src) continue;
    seenExtractionIndexes.add(ex.i);
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
      platform: VALID_PLATFORMS.includes(src.platform) ? src.platform : 'youtube',
      videoUrl: src.url,
      videoTitle: src.title.substring(0, 500),
      views: src.views,
      followers: src.followers,
      outlierScore: src.score,
      curated: false,
    });
  }

  if (dry || fresh) {
    const owned = excludeCrossNicheRows(rows, existing, currentOwned);
    if (owned.conflicts.length > 0) {
      for (const url of owned.conflicts) errors.push(`skipped source owned by another niche: ${url}`);
      rows.splice(0, rows.length, ...owned.rows);
    }
  }

  const freshReadiness = assessFreshReadiness({
    accepted: rows.length,
    transcriptEligible: transcriptReady.length,
    evaluated: seenExtractionIndexes.size,
    discoveryFailures,
    upstreamFailures,
  });

  if (dry) {
    const acceptedUrls = new Set(rows.map((row) => row.videoUrl));
    const wouldInsert = rows.filter((row) => !currentOwned.has(row.videoUrl));
    const wouldReactivate = rows.filter(
      (row) => currentOwned.has(row.videoUrl) && !currentMined.has(row.videoUrl),
    );
    const wouldReplace = rows.filter((row) => currentMined.has(row.videoUrl));
    const wouldRetire = [...currentMined].filter((url) => !acceptedUrls.has(url));
    return {
      dry: true, fresh, niche: niche.slug,
      scanned, outliers: outliers.length,
      transcriptAttempts, transcriptEligible: transcriptReady.length, transcriptFailures,
      accepted: rows.length, rejected: Math.max(0, transcriptReady.length - rows.length),
      currentMined: currentMined.size, finalMined: rows.length,
      minimumAccepted: MIN_FRESH_ACCEPTED_HOOKS,
      minimumTranscriptEligible: MIN_FRESH_TRANSCRIPT_ELIGIBLE,
      canApplyFresh: freshReadiness.canApply,
      freshBlockers: freshReadiness.blockers,
      wouldRefresh: refresh.length, wouldInsert, wouldReactivate, wouldReplace, wouldRetire,
      wouldDelete: [],
      errors,
    };
  }

  // 8. Write
  if (fresh) {
    if (!freshReadiness.canApply) {
      return {
        fresh: true, applied: false, niche: niche.slug,
        scanned, outliers: outliers.length,
        transcriptAttempts, transcriptEligible: transcriptReady.length, transcriptFailures,
        accepted: rows.length, rejected: Math.max(0, transcriptReady.length - rows.length),
        currentMined: currentMined.size, finalMined: currentMined.size,
        minimumAccepted: MIN_FRESH_ACCEPTED_HOOKS,
        minimumTranscriptEligible: MIN_FRESH_TRANSCRIPT_ELIGIBLE,
        freshBlockers: freshReadiness.blockers,
        retired: 0, removed: 0, upserted: 0,
        errors: [
          ...errors,
          'Fresh rebuild was not healthy enough to replace the niche; existing hooks were kept.',
        ],
      };
    }
    const replaced = await replaceMinedHooksForNiche(niche.id, rows);
    return {
      fresh: true, applied: true, niche: niche.slug,
      scanned, outliers: outliers.length,
      transcriptAttempts, transcriptEligible: transcriptReady.length, transcriptFailures,
      accepted: rows.length, rejected: Math.max(0, transcriptReady.length - rows.length),
      currentMined: currentMined.size, finalMined: rows.length,
      retired: replaced.retired, removed: replaced.removed,
      upserted: replaced.upserted, errors,
    };
  }

  const written = await applyIncrementalMine(niche.id, rows, refresh);

  return {
    niche: niche.slug,
    scanned, outliers: outliers.length,
    inserted: written.inserted, refreshed: written.refreshed, errors,
  };
}

// Full pipeline: discover on YouTube, fetch transcripts via Supadata, extract.
// The cron and profile-save entry point; behavior unchanged by the split.
export async function mineNiche(niche, apiKey, opts = {}) {
  const { maxKeywords = 6, maxSeedChannels = 3, ...mineOpts } = opts;
  const discovery = await discoverCandidates(niche, apiKey, { maxKeywords, maxSeedChannels });
  return mineFromCandidates(niche, discovery.outliers, {
    ...mineOpts,
    scanned: discovery.scanned,
    discoveryFailures: discovery.discoveryFailures,
    errors: discovery.errors,
    transcriptProvider: async (candidate) => (await fetchTranscript(candidate.url)).text,
  });
}
