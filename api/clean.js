// api/clean.js — Transcript Cleaner endpoint.
// Light cleaning is client-side. Medium/heavy require Pro.

import { handleCors, verifySubscription, callGemini } from './_shared.js';

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

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (handleCors(req, res)) return;

  const { transcript, level } = req.body || {};

  // Pro check for medium/heavy only
  if (level === 'medium' || level === 'heavy') {
    const subId = req.headers['x-subscription-id'];
    if (!subId) return res.status(402).json({ error: 'Pro subscription required for AI cleaning', upgrade: true });
    const isActive = await verifySubscription(subId);
    if (!isActive) return res.status(402).json({ error: 'Subscription expired or invalid', upgrade: true });
  }

  if (!transcript || typeof transcript !== 'string' || transcript.trim().length < 10) {
    return res.status(400).json({ error: 'Transcript text is required.' });
  }
  if (!level || !PROMPTS[level]) {
    return res.status(400).json({ error: 'Level must be "medium" or "heavy".' });
  }

  try {
    const result = await callGemini(PROMPTS[level], transcript, 0.3);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Clean error:', error);
    const status = error.message.includes('AI service') ? 502 : 500;
    return res.status(status).json({ error: error.message || 'Internal server error' });
  }
}
