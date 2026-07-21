// api/_shared.js — Shared helpers for all AI API endpoints.
// Vercel ignores _-prefixed files in api/ as endpoints.

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';

/**
 * Set CORS headers and handle OPTIONS preflight.
 * Returns true if the request was an OPTIONS preflight (already handled).
 */
export function handleCors(req, res) {
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  const allowed = !origin || (function () { try { return new URL(origin).host === host; } catch { return false; } })();
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') { res.status(200).end(); return true; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return true; }
  return false;
}

/**
 * Auth gate for cron endpoints (/api/mine, /api/autopilot).
 * Vercel's documented cron auth is `Authorization: Bearer ${CRON_SECRET}`.
 * Never trust a caller-supplied marker header; manual runs use the separate
 * ADMIN_SECRET query value.
 */
export function cronAuthOk(req) {
  const cron = process.env.CRON_SECRET;
  if (cron && req.headers['authorization'] === `Bearer ${cron}`) return true;
  return !!(process.env.ADMIN_SECRET && req.query && req.query.secret === process.env.ADMIN_SECRET);
}

/**
 * Generate one image with gemini-2.5-flash-image.
 * Returns a base64 PNG string (no data: prefix). Throws on failure.
 */
// Image gen fails transiently often enough to be worth one blind retry.
// Every caller wants this — the create page and the autopilot cron alike.
export async function callGeminiImageRetry(prompt) {
  try {
    return await callGeminiImage(prompt);
  } catch {
    return await callGeminiImage(prompt);
  }
}

export async function callGeminiImage(prompt) {
  if (!GEMINI_KEY) throw new Error('AI service is not available.');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(18000),
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const detail = err?.error?.message || err?.error?.status || String(response.status);
    console.error('Gemini image error:', response.status, detail);
    throw new Error('Image generation failed (' + response.status + ').');
  }

  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find((p) => p.inlineData?.data);
  if (!imgPart) throw new Error('Image generation returned no image.');
  return imgPart.inlineData.data;
}

/**
 * Call Gemini Flash Lite and return parsed JSON.
 * Truncates input text to 120k chars, sends prompt + text to Gemini.
 */
export async function callGemini(prompt, text, temperature = 0.7) {
  if (!GEMINI_KEY) throw new Error('AI service is not available.');

  let input = text.trim();
  if (input.length > 120000) {
    input = input.substring(0, 120000) + '\n\n[Transcript truncated]';
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt + '\n\nTranscript:\n' + input }] }],
        generationConfig: { temperature, responseMimeType: 'application/json' },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const detail = err?.error?.message || err?.error?.status || JSON.stringify(err).substring(0, 200);
    console.error('Gemini API error:', response.status, err);
    throw new Error('AI error (' + response.status + '): ' + detail);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error('Empty response from AI service.');

  try {
    return JSON.parse(content);
  } catch (e) {
    // Gemini sometimes returns broken JSON — try to repair common issues
    let fixed = content
      .replace(/[\x00-\x1f]/g, (ch) => {
        if (ch === '\n') return '\\n';
        if (ch === '\r') return '\\r';
        if (ch === '\t') return '\\t';
        return '';
      });

    try {
      return JSON.parse(fixed);
    } catch (e2) {
      // Last resort: extract the first JSON object or array
      const match = fixed.match(/[\[{][\s\S]*[\]}]/);
      if (match) {
        try { return JSON.parse(match[0]); } catch (_) {}
      }
      console.error('JSON parse failed:', e.message, content.substring(0, 500));
      throw new Error('AI returned an invalid response. Please try again.');
    }
  }
}
