// api/clean.js
// Transcript Cleaner endpoint — uses Gemini Flash for medium/heavy cleaning.
// Light cleaning is handled client-side (no API call needed).
// Medium/heavy require Pro subscription.
// Set GEMINI_API_KEY in Vercel environment variables.

import Stripe from 'stripe';

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

// In-memory subscription cache
const subCache = new Map();
const CACHE_TTL = 30 * 60 * 1000;

async function verifySubscription(subId) {
  if (!subId || !stripe) return false;
  const cached = subCache.get(subId);
  if (cached && (Date.now() - cached.at) < CACHE_TTL) return cached.active;
  try {
    const sub = await stripe.subscriptions.retrieve(subId);
    const active = sub.status === 'active' || sub.status === 'trialing';
    subCache.set(subId, { active, at: Date.now() });
    return active;
  } catch { return false; }
}

const PROMPTS = {
  medium: `You are a transcript editor. Clean up the given transcript by:
- Removing filler words (um, uh, like, you know, sort of, kind of, I mean, basically, actually, literally, right)
- Fixing punctuation and capitalization
- Fixing obvious grammar errors from speech-to-text
- Keeping the speaker's voice and meaning completely intact
- NOT changing the structure or adding paragraph breaks
- NOT paraphrasing or rewriting — only clean up

Return JSON with a single field: "cleaned" (string — the cleaned transcript text)`,

  heavy: `You are a professional transcript editor. Transform the given raw transcript into clean, readable prose:
- Remove all filler words and verbal tics
- Fix punctuation, capitalization, and grammar
- Break into logical paragraphs based on topic changes
- Smooth out sentence structure where needed for readability
- Keep the speaker's original meaning and voice intact
- Do NOT add new content or change the meaning
- Do NOT summarize — keep all the content, just make it readable

Return JSON with a single field: "cleaned" (string — the cleaned and restructured transcript text)`,
};

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  const allowed = !origin || (function() { try { return new URL(origin).host === host; } catch { return false; } })();
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-subscription-id');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { transcript, level } = req.body || {};

  // Pro subscription check for medium/heavy (light is client-side only)
  if (level === 'medium' || level === 'heavy') {
    const subId = req.headers['x-subscription-id'];
    if (!subId) {
      return res.status(402).json({ error: 'Pro subscription required for AI cleaning', upgrade: true });
    }
    const isActive = await verifySubscription(subId);
    if (!isActive) {
      return res.status(402).json({ error: 'Subscription expired or invalid', upgrade: true });
    }
  }

  if (!transcript || typeof transcript !== 'string' || transcript.trim().length < 10) {
    return res.status(400).json({ error: 'Transcript text is required.' });
  }

  if (!level || !PROMPTS[level]) {
    return res.status(400).json({ error: 'Level must be "medium" or "heavy".' });
  }

  if (!GEMINI_KEY) {
    return res.status(500).json({ error: 'AI service is not available.' });
  }

  try {
    let text = transcript.trim();
    if (text.length > 120000) {
      text = text.substring(0, 120000) + '\n\n[Transcript truncated]';
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: PROMPTS[level] + '\n\nTranscript:\n' + text }] }],
          generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('Gemini API error:', response.status, err);
      return res.status(502).json({ error: 'AI service error. Please try again.' });
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!content) {
      return res.status(502).json({ error: 'Empty response from AI service.' });
    }

    const result = JSON.parse(content);
    return res.status(200).json(result);

  } catch (error) {
    console.error('Clean error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
