// api/summarize.js — AI Summary endpoint. Requires Pro.

import { handleCors, requirePro, callGemini } from './_shared.js';

const SYSTEM_PROMPT = `You are an expert content analyst. Given a video transcript, produce a structured analysis in JSON format with these exact fields:

- "summary": A 3-5 paragraph overview of the content. Be concise but substantive.
- "takeaways": An array of 5-10 key insights, each as a concise sentence.
- "chapters": An array of objects with "timestamp" (in "MM:SS" format, estimated from transcript position), "title" (short chapter name), and "summary" (1-2 sentences) marking major topic transitions.
- "quotes": An array of the 3-5 most impactful or quotable statements, each an object with "text" and "timestamp" (in "MM:SS" format).

Focus on actionable insights, not filler. If the transcript is a tutorial, emphasize the steps. If it is an interview, emphasize the most interesting claims or advice. Return valid JSON only.`;

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
    console.error('Summarize error:', error);
    const status = error.message.includes('AI service') ? 502 : 500;
    return res.status(status).json({ error: error.message || 'Internal server error' });
  }
}
