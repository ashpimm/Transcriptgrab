// api/generate.js — Generate selected platform content from a transcript.

import { handleCors, callGemini } from './_shared.js';

const FORMAT_PROMPTS = {
  twitter: {
    prompt: `## Twitter/X Thread
- Start with a strong hook tweet
- Each tweet MUST be under 280 characters
- Number tweets as 1/, 2/, etc.
- Be punchy, direct, not verbose
- 8-15 tweets total
- End with a summary or CTA tweet`,
    schema: '"twitter": { "tweets": ["tweet1", "tweet2", ...] }',
  },
  linkedin: {
    prompt: `## LinkedIn Post
- Start with a hook line that stops the scroll
- Short paragraphs (1-2 sentences each)
- Line breaks between paragraphs
- Include insights and actionable takeaways
- End with a question or call to engagement
- Professional but conversational, 800-1500 words max`,
    schema: '"linkedin": { "content": "full linkedin post" }',
  },
  facebook: {
    prompt: `## Facebook Post
- Scroll-stopping hook or question
- Warm, conversational tone that invites comments
- Short paragraphs with line breaks for mobile
- Personal angle or story element
- 2-3 emoji sparingly for visual breaks
- End with a CTA or question
- 300-800 words, 0-3 hashtags max at end`,
    schema: '"facebook": { "content": "full facebook post" }',
  },
  instagram: {
    prompt: `## Instagram Caption
- Attention-grabbing first line (this shows in preview)
- Storytelling format, relatable and authentic
- Include a clear CTA (save, share, comment)
- Add relevant hashtags at the end (10-15)
- Keep under 2200 characters
- Use line breaks and emoji for readability`,
    schema: '"instagram": { "content": "full instagram caption" }',
  },
  tiktok: {
    prompt: `## TikTok Caption / Script
- Write a short, punchy caption for a TikTok video (under 300 characters)
- Also write a voiceover script (30-60 seconds, conversational, high energy)
- Include 5-8 trending-style hashtags
- Add a hook in the first line that creates curiosity`,
    schema: '"tiktok": { "caption": "short tiktok caption with hashtags", "script": "voiceover script" }',
  },
  blog: {
    prompt: `## Blog Post
- Compelling SEO-friendly headline
- Use subheadings (##, ###) to organize
- Flowing paragraphs, not transcript copy
- Introduction and conclusion
- Keep the speaker's voice and key points
- Markdown formatting`,
    schema: '"blog": { "title": "blog headline", "content": "full blog post in markdown" }',
  },
  quotes: {
    prompt: `## Key Quotes
- Extract 5-10 of the most powerful, quotable, standalone statements
- Each quote should work as a standalone social media post or image overlay
- Include the approximate timestamp if discernible from context
- For each quote, write a ready-to-tweet version (under 280 chars)`,
    schema: '"quotes": [{ "text": "the quote", "timestamp": "MM:SS or empty", "tweet": "tweetable version under 280 chars" }, ...]',
  },
};

const VALID_FORMATS = Object.keys(FORMAT_PROMPTS);

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (handleCors(req, res)) return;

  const { transcript, formats } = req.body || {};

  if (!transcript || typeof transcript !== 'string' || transcript.trim().length < 50) {
    return res.status(400).json({ error: 'Transcript text is required (minimum 50 characters).' });
  }

  // Validate formats
  const requested = Array.isArray(formats) ? formats.filter(f => VALID_FORMATS.includes(f)) : [];
  if (requested.length === 0) {
    return res.status(400).json({ error: 'Select at least one format. Valid: ' + VALID_FORMATS.join(', ') });
  }

  // Build prompt with only selected formats
  const promptParts = requested.map(f => FORMAT_PROMPTS[f].prompt);
  const schemaParts = requested.map(f => FORMAT_PROMPTS[f].schema);

  const prompt = `You are an expert content repurposer. Given a YouTube video transcript, generate ready-to-post content for the following platform(s).

${promptParts.join('\n\n')}

Return JSON with this exact structure:
{
  ${schemaParts.join(',\n  ')}
}`;

  try {
    const result = await callGemini(prompt, transcript, 0.7);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Generate error:', error);
    const status = error.message.includes('AI service') ? 502 : 500;
    return res.status(status).json({ error: error.message || 'Internal server error' });
  }
}
