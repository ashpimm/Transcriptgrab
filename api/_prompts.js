// api/_prompts.js — Shared format prompts for AI generation
// Vercel ignores _-prefixed files in api/ as endpoints.

export const FORMAT_PROMPTS = {
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

export const VALID_FORMATS = Object.keys(FORMAT_PROMPTS);
