// api/generate.js — Generate all platform content from a transcript in one call.

import { handleCors, callGemini } from './_shared.js';

const MEGA_PROMPT = `You are an expert content repurposer. Given a YouTube video transcript, generate ready-to-post content for ALL of the following platforms in a single response.

## Twitter/X Thread
- Start with a strong hook tweet
- Each tweet MUST be under 280 characters
- Number tweets as 1/, 2/, etc.
- Be punchy, direct, not verbose
- 8-15 tweets total
- End with a summary or CTA tweet

## LinkedIn Post
- Start with a hook line that stops the scroll
- Short paragraphs (1-2 sentences each)
- Line breaks between paragraphs
- Include insights and actionable takeaways
- End with a question or call to engagement
- Professional but conversational, 800-1500 words max

## Facebook Post
- Scroll-stopping hook or question
- Warm, conversational tone that invites comments
- Short paragraphs with line breaks for mobile
- Personal angle or story element
- 2-3 emoji sparingly for visual breaks
- End with a CTA or question
- 300-800 words, 0-3 hashtags max at end

## Instagram Caption
- Attention-grabbing first line (this shows in preview)
- Storytelling format, relatable and authentic
- Include a clear CTA (save, share, comment)
- Add relevant hashtags at the end (10-15)
- Keep under 2200 characters
- Use line breaks and emoji for readability

## Blog Post
- Compelling SEO-friendly headline
- Use subheadings (##, ###) to organize
- Flowing paragraphs, not transcript copy
- Introduction and conclusion
- Keep the speaker's voice and key points
- Markdown formatting

## Key Quotes
- Extract 5-10 of the most powerful, quotable, standalone statements
- Each quote should work as a standalone social media post or image overlay
- Include the approximate timestamp if discernible from context
- For each quote, write a ready-to-tweet version (under 280 chars)

Return JSON with this exact structure:
{
  "twitter": { "tweets": ["tweet1", "tweet2", ...] },
  "linkedin": { "content": "full linkedin post" },
  "facebook": { "content": "full facebook post" },
  "instagram": { "content": "full instagram caption" },
  "blog": { "title": "blog headline", "content": "full blog post in markdown" },
  "quotes": [{ "text": "the quote", "timestamp": "MM:SS or empty", "tweet": "tweetable version under 280 chars" }, ...]
}`;

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (handleCors(req, res)) return;

  const { transcript } = req.body || {};

  if (!transcript || typeof transcript !== 'string' || transcript.trim().length < 50) {
    return res.status(400).json({ error: 'Transcript text is required (minimum 50 characters).' });
  }

  try {
    const result = await callGemini(MEGA_PROMPT, transcript, 0.7);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Generate error:', error);
    const status = error.message.includes('AI service') ? 502 : 500;
    return res.status(status).json({ error: error.message || 'Internal server error' });
  }
}
