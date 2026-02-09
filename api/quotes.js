// api/quotes.js
// Quote Finder endpoint — extracts shareable, quotable moments from transcripts.
// Set GEMINI_API_KEY in Vercel environment variables.

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';

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
  const allowed = !origin || origin.includes(host);
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin || '*' : '');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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
