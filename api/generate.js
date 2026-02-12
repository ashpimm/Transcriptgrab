// api/generate.js — Generate selected platform content from a transcript.

import { handleCors, callGemini } from './_shared.js';
import { getSession, canGenerate, consumeCredit, parseCookies, getSingleCredit, consumeSingleCredit, clearCreditCookie } from './_db.js';

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
    prompt: `## LinkedIn Posts (3 variations)
- Generate 3 DIFFERENT LinkedIn posts, each covering a distinct angle, topic, or takeaway from the video
- Each post: hook line that stops the scroll, short paragraphs (1-2 sentences), line breaks between paragraphs
- Include insights and actionable takeaways
- End with a question or call to engagement
- Professional but conversational, 800-1500 words max per post
- Each variation must have a short "label" describing its angle (2-5 words)`,
    schema: '"linkedin": [{ "label": "angle name", "content": "full linkedin post" }, { "label": "angle name", "content": "full linkedin post" }, { "label": "angle name", "content": "full linkedin post" }]',
  },
  facebook: {
    prompt: `## Facebook Posts (3 variations)
- Generate 3 DIFFERENT Facebook posts, each covering a distinct angle, topic, or takeaway from the video
- Each post: scroll-stopping hook or question, warm conversational tone, short paragraphs with line breaks
- Personal angle or story element, 2-3 emoji sparingly
- End with a CTA or question
- 300-800 words per post, 0-3 hashtags max at end
- Each variation must have a short "label" describing its angle (2-5 words)`,
    schema: '"facebook": [{ "label": "angle name", "content": "full facebook post" }, { "label": "angle name", "content": "full facebook post" }, { "label": "angle name", "content": "full facebook post" }]',
  },
  instagram: {
    prompt: `## Instagram Captions (3 variations)
- Generate 3 DIFFERENT Instagram captions, each covering a distinct angle, topic, or takeaway from the video
- Each caption: attention-grabbing first line, storytelling format, relatable and authentic
- Include a clear CTA (save, share, comment)
- Add relevant hashtags at the end (10-15)
- Keep each under 2200 characters
- Use line breaks and emoji for readability
- Each variation must have a short "label" describing its angle (2-5 words)`,
    schema: '"instagram": [{ "label": "angle name", "content": "full instagram caption" }, { "label": "angle name", "content": "full instagram caption" }, { "label": "angle name", "content": "full instagram caption" }]',
  },
  tiktok: {
    prompt: `## TikTok Captions / Scripts (3 variations)
- Generate 3 DIFFERENT TikTok posts, each covering a distinct angle, topic, or takeaway from the video
- Each post: short punchy caption (under 300 characters) + voiceover script (30-60 seconds, conversational, high energy)
- Include 5-8 trending-style hashtags per variation
- Add a hook in the first line that creates curiosity
- Each variation must have a short "label" describing its angle (2-5 words)`,
    schema: '"tiktok": [{ "label": "angle name", "caption": "short tiktok caption with hashtags", "script": "voiceover script" }, { "label": "angle name", "caption": "short tiktok caption with hashtags", "script": "voiceover script" }, { "label": "angle name", "caption": "short tiktok caption with hashtags", "script": "voiceover script" }]',
  },
  blog: {
    prompt: `## Blog Posts (3 variations)
- Generate 3 DIFFERENT blog posts, each covering a distinct angle, topic, or takeaway from the video
- Each post: compelling SEO-friendly headline, subheadings (##, ###), flowing paragraphs
- Introduction and conclusion per post
- Keep the speaker's voice and key points
- Markdown formatting
- Each variation must have a short "label" describing its angle (2-5 words)`,
    schema: '"blog": [{ "label": "angle name", "title": "blog headline", "content": "full blog post in markdown" }, { "label": "angle name", "title": "blog headline", "content": "full blog post in markdown" }, { "label": "angle name", "title": "blog headline", "content": "full blog post in markdown" }]',
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

  // ===== SERVER-SIDE GATING =====
  let user = null;
  let creditToken = null;

  // Check for $5 single credit cookie first (works for all users, signed-in or not)
  const cookies = parseCookies(req);
  if (cookies.tg_credit) {
    const credit = await getSingleCredit(cookies.tg_credit);
    if (credit) {
      creditToken = cookies.tg_credit;
      // Allowed — will consume after successful generation
    }
  }

  // If no valid credit cookie, check session and normal gating
  if (!creditToken) {
    try {
      user = await getSession(req);
    } catch (e) {
      console.error('Session check failed:', e.message);
    }

    if (!user) {
      // Anonymous: check if they've used their free generation
      const freeUsed = req.headers['x-free-used'] === 'true';
      if (freeUsed) {
        return res.status(402).json({
          error: 'Purchase a video or upgrade to Pro.',
          upgrade: true,
        });
      }
      // Allow anonymous free generation (first video)
    } else {
      // Signed-in user: check credits/subscription
      const check = canGenerate(user);
      if (!check.allowed) {
        if (check.reason === 'monthly_limit') {
          return res.status(403).json({
            error: 'Monthly limit reached (200 videos). Resets next month.',
            monthly_limit: true,
          });
        }
        if (check.reason === 'upgrade') {
          return res.status(402).json({
            error: 'No credits remaining. Purchase a video or upgrade to Pro.',
            upgrade: true,
          });
        }
      }
    }
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

    // Consume credit after successful generation
    if (creditToken) {
      try {
        await consumeSingleCredit(creditToken);
        clearCreditCookie(res);
      } catch (e) {
        console.error('Single credit consumption failed:', e.message);
      }
    } else if (user) {
      try {
        await consumeCredit(user);
      } catch (e) {
        console.error('Credit consumption failed:', e.message);
      }
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('Generate error:', error);
    const status = error.message.includes('AI service') ? 502 : 500;
    return res.status(status).json({ error: error.message || 'Internal server error' });
  }
}
