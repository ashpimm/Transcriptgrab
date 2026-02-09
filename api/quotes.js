// api/quotes.js
// Quote Finder endpoint — extracts shareable, quotable moments from transcripts.
// Requires Pro subscription.
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

const SYSTEM_PROMPT = `You are an expert at identifying shareable, impactful moments in video content. Given a transcript, find 10-20 of the most quotable statements.

Look for statements that are:
- Surprising or contrarian
- Emotionally resonant
- Actionable advice
- Vivid metaphors or analogies
- Bold claims or predictions

Return JSON with a "quotes" array. Each quote object must have:
- "text": The exact quote from the transcript (clean up minor filler words if needed, but preserve the speaker's voice)
- "timestamp": The approximate timestamp in "MM:SS" format (estimate from context and position in transcript)
- "twitter": The quote formatted as a tweet (under 280 characters, punchy, standalone — add brief context if needed)
- "linkedin": The quote formatted for LinkedIn (can be longer, more professional, add 1-2 sentences of context)

Return valid JSON only.`;

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

  // Pro subscription check
  const subId = req.headers['x-subscription-id'];
  if (!subId) {
    return res.status(402).json({ error: 'Pro subscription required', upgrade: true });
  }
  const isActive = await verifySubscription(subId);
  if (!isActive) {
    return res.status(402).json({ error: 'Subscription expired or invalid', upgrade: true });
  }

  const { transcript } = req.body || {};

  if (!transcript || typeof transcript !== 'string' || transcript.trim().length < 50) {
    return res.status(400).json({ error: 'Transcript text is required (minimum 50 characters).' });
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
          contents: [{ parts: [{ text: SYSTEM_PROMPT + '\n\nTranscript:\n' + text }] }],
          generationConfig: { temperature: 0.7, responseMimeType: 'application/json' },
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
    console.error('Quotes error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
