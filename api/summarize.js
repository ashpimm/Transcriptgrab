// api/summarize.js
// AI Summary endpoint — sends transcript to Gemini Flash for structured analysis.
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

const SYSTEM_PROMPT = `You are an expert content analyst. Given a video transcript, produce a structured analysis in JSON format with these exact fields:

- "summary": A 3-5 paragraph overview of the content. Be concise but substantive.
- "takeaways": An array of 5-10 key insights, each as a concise sentence.
- "chapters": An array of objects with "timestamp" (in "MM:SS" format, estimated from transcript position), "title" (short chapter name), and "summary" (1-2 sentences) marking major topic transitions.
- "quotes": An array of the 3-5 most impactful or quotable statements, each an object with "text" and "timestamp" (in "MM:SS" format).

Focus on actionable insights, not filler. If the transcript is a tutorial, emphasize the steps. If it is an interview, emphasize the most interesting claims or advice. Return valid JSON only.`;

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  const allowed = !origin || origin.includes(host);
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin || '*' : '');
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
    return res.status(500).json({ error: 'AI service not configured. Set GEMINI_API_KEY in environment variables.' });
  }

  try {
    let text = transcript.trim();
    if (text.length > 120000) {
      text = text.substring(0, 120000) + '\n\n[Transcript truncated due to length]';
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
    console.error('Summarize error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
