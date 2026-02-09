// api/transcript.js
// Deploy on Vercel (free tier) as a serverless function.
//
// PIPELINE:
//   1. Try YouTube's built-in captions (free, instant)
//   2. If no captions → extract audio URL → send to AssemblyAI for STT
//
// AssemblyAI: $50 free credit (~333 hours). After that, $0.15/hr.
// Set ASSEMBLYAI_API_KEY in Vercel environment variables.

import Stripe from 'stripe';

const ASSEMBLYAI_KEY = process.env.ASSEMBLYAI_API_KEY || '';
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

// =============================================================
// IN-MEMORY RATE LIMITER (per serverless instance)
// Not bulletproof across instances, but catches casual abuse.
// =============================================================
const rateMap = new Map(); // IP -> { count, resetAt }
const RATE_LIMIT = 10;     // max requests per window
const RATE_WINDOW = 60000; // 1 minute in ms

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return false;
  }

  entry.count++;
  if (entry.count > RATE_LIMIT) {
    return true;
  }
  return false;
}

// Periodically clean stale entries to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateMap) {
    if (now > entry.resetAt) rateMap.delete(ip);
  }
}, RATE_WINDOW);

export const config = {
  maxDuration: 120, // Allow up to 120s for transcription (Vercel Pro: 300s)
};

export default async function handler(req, res) {
  // CORS — restrict to same origin
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  const allowed = !origin || origin.includes(host);
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin || '*' : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const videoId = req.query.v;
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Invalid or missing video ID' });
  }

  const mode = req.query.mode || 'single';

  // ===== RATE LIMITING (single mode only) =====
  if (mode === 'single') {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.headers['x-real-ip']
      || req.socket?.remoteAddress
      || 'unknown';
    if (isRateLimited(ip)) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please wait a moment before trying again.' });
    }
  }

  // ===== PAYMENT VERIFICATION (bulk mode) =====
  if (mode === 'bulk') {
    const sessionId = req.query.session_id;

    if (!sessionId || !sessionId.startsWith('cs_')) {
      return res.status(403).json({ error: 'Payment required. A valid Stripe session is needed for bulk mode.' });
    }

    if (!stripe) {
      return res.status(500).json({ error: 'Payment verification is not configured.' });
    }

    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status !== 'paid') {
        return res.status(403).json({ error: 'Payment not completed. Please complete your purchase first.' });
      }
    } catch (stripeErr) {
      console.error('Stripe verification failed:', stripeErr.message);
      return res.status(403).json({ error: 'Invalid or expired payment session.' });
    }
  }

  try {
    // ===== STEP 1: Try YouTube's built-in captions =====
    const captionResult = await tryYouTubeCaptions(videoId);

    if (captionResult.success) {
      return res.status(200).json({
        ...captionResult.data,
        source: 'youtube_captions',
      });
    }

    console.log(`No captions for ${videoId}: ${captionResult.error}. Falling back to AssemblyAI.`);

    // ===== STEP 2: Fallback to AssemblyAI (all modes) =====
    if (!ASSEMBLYAI_KEY) {
      return res.status(404).json({
        error: 'No captions available and speech-to-text is not configured.',
        source: 'none',
      });
    }

    const sttResult = await transcribeWithAssemblyAI(videoId);

    if (sttResult.success) {
      return res.status(200).json({
        ...sttResult.data,
        source: 'assemblyai',
      });
    }

    return res.status(500).json({
      error: sttResult.error,
      transcriptId: sttResult.transcriptId || null,
      source: 'assemblyai_failed',
    });

  } catch (error) {
    console.error('Transcript handler error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}


// =============================================================
// SHARED HEADERS — consent cookie bypasses GDPR consent page
// that YouTube serves to data center IPs (like Vercel)
// =============================================================
const YT_CONSENT_COOKIE = 'SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgJnOlwY';
const YT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// =============================================================
// YOUTUBE CAPTIONS (FREE — multi-strategy approach)
// YouTube blocks direct API calls from data center IPs (Vercel),
// so we use public Invidious/Piped instances as primary strategy,
// with direct YouTube fallback in case they start working again.
// =============================================================

// Public API instances for caption extraction (rotated on failure)
const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.fdn.fr',
  'https://invidious.nerdvpn.de',
  'https://vid.puffyan.us',
];

const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://api.piped.projectsegfault.com',
];

async function tryYouTubeCaptions(videoId) {
  // Strategy 1: Invidious API (most reliable from servers)
  const invResult = await tryInvidiousCaptions(videoId);
  if (invResult.success) return invResult;
  console.log(`Invidious failed for ${videoId}: ${invResult.error}`);

  // Strategy 2: Piped API
  const pipedResult = await tryPipedCaptions(videoId);
  if (pipedResult.success) return pipedResult;
  console.log(`Piped failed for ${videoId}: ${pipedResult.error}`);

  // Strategy 3: Direct YouTube (works if not blocked by bot detection)
  const directResult = await tryDirectYouTube(videoId);
  if (directResult.success) return directResult;
  console.log(`Direct YouTube failed for ${videoId}: ${directResult.error}`);

  return { success: false, error: 'No caption tracks found via any method' };
}

// --- Strategy 1: Invidious API ---
async function tryInvidiousCaptions(videoId) {
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      // Get caption list
      const listRes = await fetch(`${instance}/api/v1/captions/${videoId}`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000),
      });

      if (!listRes.ok) {
        console.log(`Invidious ${instance}: HTTP ${listRes.status}`);
        continue;
      }

      const listData = await listRes.json();
      const tracks = listData?.captions || [];
      if (tracks.length === 0) {
        console.log(`Invidious ${instance}: no caption tracks`);
        continue;
      }

      // Pick best track
      let track = tracks.find(t => t.language_code === 'en' && !t.label?.includes('auto'));
      if (!track) track = tracks.find(t => t.language_code === 'en');
      if (!track) track = tracks[0];

      // Fetch caption content as VTT
      const captionUrl = track.url.startsWith('http')
        ? track.url
        : `${instance}${track.url}`;
      const captionRes = await fetch(captionUrl, {
        signal: AbortSignal.timeout(8000),
      });

      if (!captionRes.ok) {
        console.log(`Invidious ${instance}: caption fetch HTTP ${captionRes.status}`);
        continue;
      }

      const captionText = await captionRes.text();
      const segments = parseVTT(captionText);
      if (segments.length === 0) {
        console.log(`Invidious ${instance}: parsed 0 segments`);
        continue;
      }

      const title = await getVideoTitle(videoId) || `Video ${videoId}`;
      console.log(`Invidious ${instance}: success, ${segments.length} segments`);

      return {
        success: true,
        data: {
          title, videoId,
          language: track.language_code || 'en',
          isAutoGenerated: track.label?.toLowerCase().includes('auto') || false,
          durationSeconds: null,
          segments,
          totalSegments: segments.length,
        }
      };
    } catch (err) {
      console.log(`Invidious ${instance}: ${err.message}`);
      continue;
    }
  }
  return { success: false, error: 'All Invidious instances failed' };
}

// --- Strategy 2: Piped API ---
async function tryPipedCaptions(videoId) {
  for (const instance of PIPED_INSTANCES) {
    try {
      const res = await fetch(`${instance}/streams/${videoId}`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        console.log(`Piped ${instance}: HTTP ${res.status}`);
        continue;
      }

      const data = await res.json();
      const subtitles = data?.subtitles || [];
      if (subtitles.length === 0) {
        console.log(`Piped ${instance}: no subtitles`);
        continue;
      }

      // Pick best subtitle track
      let track = subtitles.find(s => s.code === 'en' && !s.autoGenerated);
      if (!track) track = subtitles.find(s => s.code === 'en');
      if (!track) track = subtitles[0];

      // Fetch caption content
      const captionRes = await fetch(track.url, {
        signal: AbortSignal.timeout(8000),
      });

      if (!captionRes.ok) {
        console.log(`Piped ${instance}: caption fetch HTTP ${captionRes.status}`);
        continue;
      }

      const captionText = await captionRes.text();
      const segments = parseVTT(captionText);
      if (segments.length === 0) {
        console.log(`Piped ${instance}: parsed 0 segments`);
        continue;
      }

      const title = data?.title || await getVideoTitle(videoId) || `Video ${videoId}`;
      const durationSeconds = data?.duration || null;
      console.log(`Piped ${instance}: success, ${segments.length} segments`);

      return {
        success: true,
        data: {
          title, videoId,
          language: track.code || 'en',
          isAutoGenerated: track.autoGenerated || false,
          durationSeconds, segments,
          totalSegments: segments.length,
        }
      };
    } catch (err) {
      console.log(`Piped ${instance}: ${err.message}`);
      continue;
    }
  }
  return { success: false, error: 'All Piped instances failed' };
}

// --- Strategy 3: Direct YouTube (fallback if not blocked) ---
async function tryDirectYouTube(videoId) {
  try {
    // Fetch watch page
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': YT_USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml',
        'Cookie': YT_CONSENT_COOKIE,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return { success: false, error: `Watch page HTTP ${res.status}` };
    const html = await res.text();

    // Check for bot detection
    if (html.includes('Sign in to confirm') || html.includes('bot')) {
      return { success: false, error: 'YouTube bot detection active' };
    }

    // Extract caption tracks
    let captionTracks;
    const patterns = [
      /"captionTracks":\s*(\[.*?\])\s*,\s*"/s,
      /"captionTracks":\s*(\[.*?\])/s,
    ];
    for (const pattern of patterns) {
      try {
        const m = html.match(pattern);
        if (m) { captionTracks = JSON.parse(m[1]); break; }
      } catch (e) { continue; }
    }

    if (!captionTracks || captionTracks.length === 0) {
      return { success: false, error: 'No caption tracks in page HTML' };
    }

    let track = captionTracks.find(t => t.languageCode === 'en' && t.kind !== 'asr');
    if (!track) track = captionTracks.find(t => t.languageCode === 'en');
    if (!track) track = captionTracks[0];

    const captionUrl = track.baseUrl + '&fmt=json3';
    const captionRes = await fetch(captionUrl);
    if (!captionRes.ok) return { success: false, error: 'Caption fetch failed' };

    const captionData = await captionRes.json();
    const segments = parseJson3Events(captionData);
    if (segments.length === 0) return { success: false, error: 'Captions empty' };

    const titleMatch = html.match(/<title>(.*?)<\/title>/);
    const title = titleMatch ? titleMatch[1].replace(' - YouTube', '').trim() : `Video ${videoId}`;

    return {
      success: true,
      data: {
        title, videoId,
        language: track.languageCode,
        isAutoGenerated: track.kind === 'asr',
        durationSeconds: null,
        segments,
        totalSegments: segments.length,
      }
    };
  } catch (err) {
    return { success: false, error: `Direct YouTube error: ${err.message}` };
  }
}

// --- Parse WebVTT caption format ---
function parseVTT(vttText) {
  const segments = [];
  const lines = vttText.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    // Look for timestamp lines: 00:00:01.234 --> 00:00:04.567
    const tsMatch = line.match(/^(\d{2}:)?(\d{2}):(\d{2}\.\d{3})\s*-->\s*(\d{2}:)?(\d{2}):(\d{2}\.\d{3})/);
    if (tsMatch) {
      const startH = tsMatch[1] ? parseInt(tsMatch[1]) : 0;
      const startM = parseInt(tsMatch[2]);
      const startS = parseFloat(tsMatch[3]);
      const endH = tsMatch[4] ? parseInt(tsMatch[4]) : 0;
      const endM = parseInt(tsMatch[5]);
      const endS = parseFloat(tsMatch[6]);

      const start = startH * 3600 + startM * 60 + startS;
      const end = endH * 3600 + endM * 60 + endS;

      // Collect text lines until blank line
      i++;
      const textLines = [];
      while (i < lines.length && lines[i].trim() !== '') {
        textLines.push(lines[i].trim());
        i++;
      }

      const text = textLines.join(' ')
        .replace(/<[^>]+>/g, '') // strip VTT tags
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .trim();

      if (text) {
        segments.push({
          start: Math.round(start * 100) / 100,
          duration: Math.round((end - start) * 100) / 100,
          text,
        });
      }
    }
    i++;
  }

  return segments;
}

// --- Shared: parse json3 caption format ---
function parseJson3Events(captionData) {
  return (captionData.events || [])
    .filter(e => e.segs && e.segs.length > 0)
    .map(e => ({
      start: (e.tStartMs || 0) / 1000,
      duration: (e.dDurationMs || 0) / 1000,
      text: e.segs.map(s => s.utf8 || '').join('').trim()
    }))
    .filter(s => s.text.length > 0);
}


// =============================================================
// ASSEMBLYAI FALLBACK (for videos without captions)
// =============================================================
async function transcribeWithAssemblyAI(videoId) {
  try {
    // --- Step A: Get a direct audio URL from YouTube ---
    const audioUrl = await getYouTubeAudioUrl(videoId);
    if (!audioUrl) {
      return { success: false, error: 'Could not extract audio URL from YouTube' };
    }

    // Also grab the title
    const title = await getVideoTitle(videoId);

    // --- Step B: Submit to AssemblyAI ---
    const submitRes = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: {
        'Authorization': ASSEMBLYAI_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audio_url: audioUrl,
        language_detection: true,
      }),
    });

    if (!submitRes.ok) {
      const errData = await submitRes.json().catch(() => ({}));
      return { success: false, error: `AssemblyAI submit failed: ${errData.error || submitRes.statusText}` };
    }

    const submitData = await submitRes.json();
    const transcriptId = submitData.id;

    // --- Step C: Poll for completion ---
    const maxWaitMs = 110000; // ~110s buffer for Vercel's 120s limit
    const pollIntervalMs = 3000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      await sleep(pollIntervalMs);

      const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
        headers: { 'Authorization': ASSEMBLYAI_KEY },
      });

      if (!pollRes.ok) {
        return { success: false, error: 'Failed to check transcription status' };
      }

      const pollData = await pollRes.json();

      if (pollData.status === 'completed') {
        // Group AssemblyAI words into sentence-sized segments
        const segments = groupWordsIntoSegments(pollData.words || [], pollData.text);
        const durationSec = pollData.audio_duration ? Math.round(pollData.audio_duration) : null;

        return {
          success: true,
          data: {
            title: title || `Video ${videoId}`,
            videoId,
            language: pollData.language_code || 'unknown',
            isAutoGenerated: false,
            isSpeechToText: true,
            durationSeconds: durationSec,
            segments,
            totalSegments: segments.length,
          }
        };
      }

      if (pollData.status === 'error') {
        return { success: false, error: `Transcription failed: ${pollData.error || 'Unknown error'}` };
      }
    }

    // Timed out — return the transcript ID so frontend can poll separately
    return {
      success: false,
      error: 'Transcription is still processing. Longer videos may take a few minutes.',
      transcriptId,
    };

  } catch (err) {
    return { success: false, error: `AssemblyAI error: ${err.message}` };
  }
}


// =============================================================
// HELPER: Group word-level data into sentence-like segments
// =============================================================
function groupWordsIntoSegments(words, fullText) {
  if (!words || words.length === 0) {
    // No word-level data — return full text as single segment
    if (fullText) {
      return [{ start: 0, duration: 0, text: fullText }];
    }
    return [];
  }

  const segments = [];
  let currentSeg = null;

  for (const word of words) {
    const needsNewSegment =
      !currentSeg ||
      currentSeg.wordCount >= 18 || // Max ~18 words per segment
      (word.start - currentSeg.lastEnd) > 1500 || // >1.5s pause = new segment
      (currentSeg.text.endsWith('.') || currentSeg.text.endsWith('?') || currentSeg.text.endsWith('!'));

    if (needsNewSegment) {
      if (currentSeg) {
        segments.push({
          start: Math.round(currentSeg.start * 100) / 100,
          duration: Math.round(((currentSeg.lastEnd / 1000) - currentSeg.start) * 100) / 100,
          text: currentSeg.text,
        });
      }
      currentSeg = {
        start: word.start / 1000,
        text: '',
        wordCount: 0,
        lastEnd: word.end,
      };
    }

    currentSeg.text += (currentSeg.text ? ' ' : '') + word.text;
    currentSeg.wordCount++;
    currentSeg.lastEnd = word.end;
  }

  // Push last segment
  if (currentSeg && currentSeg.text) {
    segments.push({
      start: Math.round(currentSeg.start * 100) / 100,
      duration: Math.round(((currentSeg.lastEnd / 1000) - currentSeg.start) * 100) / 100,
      text: currentSeg.text,
    });
  }

  return segments;
}


// =============================================================
// HELPER: Get YouTube audio stream URL (Piped API + YouTube fallback)
// =============================================================
async function getYouTubeAudioUrl(videoId) {
  // Try Piped instances first — they return direct audio stream URLs
  for (const instance of PIPED_INSTANCES) {
    try {
      const res = await fetch(`${instance}/streams/${videoId}`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;

      const data = await res.json();
      const audioStreams = (data?.audioStreams || [])
        .filter(s => s.url)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

      if (audioStreams.length > 0) {
        console.log(`Audio URL via Piped ${instance}: bitrate=${audioStreams[0].bitrate}`);
        return audioStreams[0].url;
      }
    } catch (err) {
      console.log(`Piped audio ${instance}: ${err.message}`);
    }
  }

  // Fallback: try YouTube directly (may be blocked by bot detection)
  try {
    const response = await fetch('https://www.youtube.com/youtubei/v1/player', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': YT_USER_AGENT,
        'Cookie': YT_CONSENT_COOKIE,
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20260115.01.00',
            hl: 'en', gl: 'US',
          }
        },
        contentCheckOk: true,
        racyCheckOk: true,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data?.playabilityStatus?.status === 'OK') {
        const formats = data?.streamingData?.adaptiveFormats || [];
        const audio = formats
          .filter(f => f.mimeType?.startsWith('audio/') && f.url)
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        if (audio.length > 0) {
          console.log(`Audio URL via YouTube direct: bitrate=${audio[0].bitrate}`);
          return audio[0].url;
        }
      }
    }
  } catch (err) {
    console.log(`YouTube direct audio: ${err.message}`);
  }

  return null;
}


// =============================================================
// HELPER: Get video title via oEmbed
// =============================================================
async function getVideoTitle(videoId) {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    );
    if (res.ok) {
      const data = await res.json();
      return data.title;
    }
  } catch {}
  return null;
}


// =============================================================
// HELPER: Async polling endpoint (for long videos)
// This lets the frontend poll directly if the initial request timed out
// =============================================================
// To use: GET /api/transcript?poll=TRANSCRIPT_ID
// (Add this routing in your main handler if needed)


function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
