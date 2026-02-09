// api/clean.js
// Transcript Cleaner endpoint — uses Gemini Flash for medium/heavy cleaning.
// Light cleaning is handled client-side (no API call needed).
// Set GEMINI_API_KEY in Vercel environment variables.

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';

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
  const allowed = !origin || origin.includes(host);
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin || '*' : '');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { transcript, level } = req.body || {};

  if (!transcript || typeof transcript !== 'string' || transcript.trim().length < 10) {
    return res.status(400).json({ error: 'Transcript text is required.' });
  }

  if (!level || !PROMPTS[level]) {
    return res.status(400).json({ error: 'Level must be "medium" or "heavy".' });
  }

  if (!GEMINI_KEY) {
    return res.status(500).json({ error: 'AI service not configured. Set GEMINI_API_KEY in environment variables.' });
  }

  try {
    let text = transcript.trim();
    if (text.length > 120000) {
      text = text.substring(0, 120000) + '\n\n[Transcript truncated]';
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
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
