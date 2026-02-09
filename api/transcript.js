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
// YOUTUBE CAPTIONS (FREE — multi-strategy approach)
// =============================================================
async function tryYouTubeCaptions(videoId) {
  // Strategy 1: Innertube get_transcript endpoint (what transcript libraries use)
  const transcriptResult = await tryGetTranscript(videoId);
  if (transcriptResult.success) return transcriptResult;
  console.log(`get_transcript failed for ${videoId}: ${transcriptResult.error}`);

  // Strategy 2: Innertube player API with ANDROID client
  const innertubeResult = await tryInnertubeCaption(videoId);
  if (innertubeResult.success) return innertubeResult;
  console.log(`Innertube failed for ${videoId}: ${innertubeResult.error}`);

  // Strategy 3: Scrape watch page as fallback
  const scrapeResult = await tryScrapeCaption(videoId);
  if (scrapeResult.success) return scrapeResult;
  console.log(`Scrape failed for ${videoId}: ${scrapeResult.error}`);

  return { success: false, error: 'No caption tracks found via any method' };
}

// --- Strategy 1: Innertube get_transcript (most reliable from servers) ---
async function tryGetTranscript(videoId) {
  try {
    // Build protobuf-encoded params for the video ID
    // Structure: field 1 { field 1 { videoId } }
    const innerBytes = Buffer.from(`\x0a\x0b${videoId}`);
    const params = Buffer.concat([
      Buffer.from([0x0a, innerBytes.length]),
      innerBytes
    ]).toString('base64');

    const response = await fetch('https://www.youtube.com/youtubei/v1/get_transcript', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20250101.00.00',
            hl: 'en',
            gl: 'US',
          }
        },
        params,
      }),
    });

    if (!response.ok) {
      return { success: false, error: `get_transcript HTTP ${response.status}` };
    }

    const data = await response.json();

    // Navigate the response structure to find cue groups
    const actions = data?.actions;
    if (!actions || actions.length === 0) {
      return { success: false, error: 'No actions in get_transcript response' };
    }

    // Find the transcript renderer in the response
    let cueGroups = null;
    for (const action of actions) {
      const panel = action?.updateEngagementPanelAction?.content
        ?.transcriptRenderer?.body?.transcriptBodyRenderer?.cueGroups;
      if (panel) { cueGroups = panel; break; }
    }

    if (!cueGroups || cueGroups.length === 0) {
      return { success: false, error: 'No cue groups found in transcript response' };
    }

    // Parse cue groups into segments
    const segments = [];
    for (const group of cueGroups) {
      const cues = group?.transcriptCueGroupRenderer?.cues;
      if (!cues) continue;
      for (const cue of cues) {
        const renderer = cue?.transcriptCueRenderer;
        if (!renderer) continue;
        const text = renderer.cue?.simpleText || '';
        const startMs = parseInt(renderer.startOffsetMs || '0');
        const durationMs = parseInt(renderer.durationMs || '0');
        if (text.trim()) {
          segments.push({
            start: startMs / 1000,
            duration: durationMs / 1000,
            text: text.trim(),
          });
        }
      }
    }

    if (segments.length === 0) {
      return { success: false, error: 'Transcript cues were empty' };
    }

    // Get title via oEmbed
    const title = await getVideoTitle(videoId) || `Video ${videoId}`;

    return {
      success: true,
      data: {
        title,
        videoId,
        language: 'en',
        isAutoGenerated: true, // get_transcript doesn't distinguish, assume auto
        durationSeconds: null,
        segments,
        totalSegments: segments.length,
      }
    };
  } catch (err) {
    return { success: false, error: `get_transcript error: ${err.message}` };
  }
}

// --- Strategy 2: Innertube ANDROID client ---
async function tryInnertubeCaption(videoId) {
  try {
    const response = await fetch('https://www.youtube.com/youtubei/v1/player', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 12)',
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '19.09.37',
            androidSdkVersion: 31,
            hl: 'en',
            gl: 'US',
          }
        },
        contentCheckOk: true,
        racyCheckOk: true,
      }),
    });

    if (!response.ok) return { success: false, error: `Innertube HTTP ${response.status}` };

    const data = await response.json();
    const title = data?.videoDetails?.title || `Video ${videoId}`;
    const durationSeconds = data?.videoDetails?.lengthSeconds ? parseInt(data.videoDetails.lengthSeconds) : null;
    const captionTracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    if (!captionTracks || captionTracks.length === 0) {
      return { success: false, error: 'No caption tracks in Innertube response' };
    }

    let track = captionTracks.find(t => t.languageCode === 'en' && t.kind !== 'asr');
    if (!track) track = captionTracks.find(t => t.languageCode === 'en');
    if (!track) track = captionTracks[0];

    const captionUrl = track.baseUrl + '&fmt=json3';
    const captionRes = await fetch(captionUrl);
    if (!captionRes.ok) return { success: false, error: 'Innertube caption fetch failed' };

    const captionData = await captionRes.json();
    const segments = parseJson3Events(captionData);
    if (segments.length === 0) return { success: false, error: 'Innertube captions empty' };

    return {
      success: true,
      data: {
        title, videoId,
        language: track.languageCode,
        isAutoGenerated: track.kind === 'asr',
        durationSeconds, segments,
        totalSegments: segments.length,
      }
    };
  } catch (err) {
    return { success: false, error: `Innertube error: ${err.message}` };
  }
}

// --- Strategy 3: Scrape watch page ---
async function tryScrapeCaption(videoId) {
  try {
    const videoPageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml',
      }
    });

    if (!videoPageRes.ok) return { success: false, error: `Watch page HTTP ${videoPageRes.status}` };
    const html = await videoPageRes.text();
    console.log(`Scrape: page size=${html.length}, hasCaptionTracks=${html.includes('captionTracks')}, title=${html.match(/<title>(.*?)<\/title>/)?.[1]?.substring(0, 50)}`);

    const titleMatch = html.match(/<title>(.*?)<\/title>/);
    const title = titleMatch ? titleMatch[1].replace(' - YouTube', '').trim() : `Video ${videoId}`;
    const durationMatch = html.match(/"lengthSeconds":"(\d+)"/);
    const durationSeconds = durationMatch ? parseInt(durationMatch[1]) : null;

    // Try multiple regex patterns for caption tracks
    let captionTracks;
    const patterns = [
      /"captionTracks":\s*(\[.*?\])\s*,\s*"/s,
      /"captionTracks":\s*(\[.*?\])/s,
    ];

    for (const pattern of patterns) {
      try {
        const m = html.match(pattern);
        if (m) {
          captionTracks = JSON.parse(m[1]);
          break;
        }
      } catch (e) { continue; }
    }

    if (!captionTracks || captionTracks.length === 0) {
      return { success: false, error: 'No caption tracks in page HTML' };
    }

    let track = captionTracks.find(t => t.languageCode === 'en' && !t.kind);
    if (!track) track = captionTracks.find(t => t.languageCode === 'en');
    if (!track) track = captionTracks[0];

    const captionUrl = track.baseUrl + '&fmt=json3';
    const captionRes = await fetch(captionUrl);
    if (!captionRes.ok) return { success: false, error: 'Scrape caption fetch failed' };

    const captionData = await captionRes.json();
    const segments = parseJson3Events(captionData);
    if (segments.length === 0) return { success: false, error: 'Scraped captions empty' };

    return {
      success: true,
      data: {
        title, videoId,
        language: track.languageCode,
        isAutoGenerated: track.kind === 'asr',
        durationSeconds, segments,
        totalSegments: segments.length,
      }
    };
  } catch (err) {
    return { success: false, error: `Scrape error: ${err.message}` };
  }
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
// HELPER: Get YouTube audio stream URL via Innertube API
// =============================================================
async function getYouTubeAudioUrl(videoId) {
  try {
    const response = await fetch('https://www.youtube.com/youtubei/v1/player', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '19.09.37',
            androidSdkVersion: 30,
            hl: 'en',
            gl: 'US',
            utcOffsetMinutes: 0,
          }
        },
        contentCheckOk: true,
        racyCheckOk: true,
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const formats = data?.streamingData?.adaptiveFormats || [];

    // Find best audio-only stream
    const audioFormats = formats
      .filter(f => f.mimeType && f.mimeType.startsWith('audio/'))
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

    if (audioFormats.length === 0) return null;

    return audioFormats[0].url || null;
  } catch (err) {
    console.error('Failed to get audio URL:', err);
    return null;
  }
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
