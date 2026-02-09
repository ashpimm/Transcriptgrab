// api/quotes.js — Quote Finder endpoint. Requires Pro.

import { handleCors, requirePro, callGemini } from './_shared.js';

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

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (await requirePro(req, res)) return;

  const { transcript } = req.body || {};
  if (!transcript || typeof transcript !== 'string' || transcript.trim().length < 50) {
    return res.status(400).json({ error: 'Transcript text is required (minimum 50 characters).' });
  }

  try {
    const result = await callGemini(SYSTEM_PROMPT, transcript, 0.7);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Quotes error:', error);
    const status = error.message.includes('AI service') ? 502 : 500;
    return res.status(status).json({ error: error.message || 'Internal server error' });
  }
}
