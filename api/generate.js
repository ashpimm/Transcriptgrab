// api/generate.js — Generate selected platform content from a transcript.

import { handleCors, callGemini } from './_shared.js';
import { getSession, canGenerate, consumeCredit, parseCookies, getSingleCredit, consumeSingleCredit, clearCreditCookie, saveGeneration } from './_db.js';
import { FORMAT_PROMPTS, VALID_FORMATS } from './_prompts.js';

export const config = { maxDuration: 60 };

// In-memory rate limiter (per serverless instance)
const rateMap = new Map();
const RATE_LIMIT = 5;
const RATE_WINDOW = 60000;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateMap) {
    if (now > entry.resetAt) rateMap.delete(ip);
  }
}, RATE_WINDOW);

export default async function handler(req, res) {
  if (handleCors(req, res)) return;

  // Rate limit by IP
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded. Please wait a moment.' });
  }

  const { transcript, formats, videoId, videoTitle, platform, videoUrl } = req.body || {};

  if (!transcript || typeof transcript !== 'string' || transcript.trim().length < 50) {
    return res.status(400).json({ error: 'Transcript text is required (minimum 50 characters).' });
  }

  // Validate formats
  const requested = Array.isArray(formats) ? formats.filter(f => VALID_FORMATS.includes(f)) : [];
  if (requested.length === 0) {
    return res.status(400).json({ error: 'Select at least one format. Valid: ' + VALID_FORMATS.join(', ') });
  }

  // ===== SERVER-SIDE GATING =====
  let user = null;
  let creditToken = null;

  // Check for $5 single credit cookie first (works for all users, signed-in or not)
  const cookies = parseCookies(req);
  if (cookies.tg_credit) {
    const credit = await getSingleCredit(cookies.tg_credit);
    if (credit) {
      creditToken = cookies.tg_credit;
      // Allowed — will consume after successful generation
    }
  }

  // If no valid credit cookie, check session and normal gating
  if (!creditToken) {
    try {
      user = await getSession(req);
    } catch (e) {
      console.error('Session check failed:', e.message);
    }

    if (!user) {
      // Anonymous: server-set cookie tracks whether free generation was used
      if (cookies.tg_free_gen) {
        return res.status(402).json({
          error: 'Purchase a video or upgrade to Pro.',
          upgrade: true,
        });
      }
      // Allow anonymous free generation (first video)
    } else {
      // Signed-in user: check credits/subscription
      const check = canGenerate(user);
      if (!check.allowed) {
        if (check.reason === 'monthly_limit') {
          return res.status(403).json({
            error: 'Monthly limit reached (200 videos). Resets next month.',
            monthly_limit: true,
          });
        }
        if (check.reason === 'upgrade') {
          return res.status(402).json({
            error: 'No credits remaining. Purchase a video or upgrade to Pro.',
            upgrade: true,
          });
        }
      }
    }
  }

  // Build prompt with only selected formats
  const promptParts = requested.map(f => FORMAT_PROMPTS[f].prompt);
  const schemaParts = requested.map(f => FORMAT_PROMPTS[f].schema);

  const prompt = `You are an expert content repurposer. Given a video transcript, generate ready-to-post content for the following platform(s).

${promptParts.join('\n\n')}

Return JSON with this exact structure:
{
  ${schemaParts.join(',\n  ')}
}`;

  try {
    const result = await callGemini(prompt, transcript, 0.7);

    // Consume credit after successful generation
    if (creditToken) {
      try {
        await consumeSingleCredit(creditToken);
        clearCreditCookie(res);
      } catch (e) {
        console.error('Single credit consumption failed:', e.message);
      }
    } else if (user) {
      try {
        await consumeCredit(user);
      } catch (e) {
        console.error('Credit consumption failed:', e.message);
      }
    }

    // Save to workspace for signed-in users (non-fatal)
    if (user && (videoId || videoUrl)) {
      try {
        const plat = platform || 'youtube';
        const thumb = plat === 'youtube' && videoId
          ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
          : '';
        const saveId = videoId || videoUrl;
        await saveGeneration(user.id, saveId, videoTitle || '', thumb, requested, result, plat);
      } catch (e) {
        console.error('Generation save failed:', e.message);
      }
    }

    // Mark anonymous free generation as used (server-side cookie)
    if (!creditToken && !user) {
      const existing = res.getHeader('Set-Cookie');
      const freeGenCookie = 'tg_free_gen=1; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000';
      if (existing) {
        const arr = Array.isArray(existing) ? existing : [existing];
        res.setHeader('Set-Cookie', [...arr, freeGenCookie]);
      } else {
        res.setHeader('Set-Cookie', freeGenCookie);
      }
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('Generate error:', error);
    const isAiError = error.message?.includes('AI service') || error.message?.includes('AI error');
    const status = isAiError ? 502 : 500;
    const msg = error.message?.startsWith('AI error')
      ? 'AI service temporarily unavailable. Please try again.'
      : (error.message || 'Internal server error');
    return res.status(status).json({ error: msg });
  }
}
