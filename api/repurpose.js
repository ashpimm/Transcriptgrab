// api/repurpose.js — Content Repurposer endpoint. Requires Pro.

import { handleCors, requirePro, callGemini } from './_shared.js';

const FORMAT_PROMPTS = {
  blog: `You are an expert content writer. Transform the given video transcript into a well-structured blog post.

Rules:
- Write a compelling headline
- Use subheadings (##, ###) to organize sections
- Write in flowing paragraphs, not a transcript copy
- Add an introduction and conclusion
- Keep the original speaker's voice and key points
- Use markdown formatting

Return JSON with: "title" (string — the blog post headline), "content" (string — the full blog post in markdown)`,

  twitter: `You are a viral Twitter/X thread writer. Transform the given video transcript into an engaging Twitter thread.

Rules:
- Start with a strong hook tweet that makes people want to read more
- Each tweet MUST be under 280 characters
- Number tweets as 1/, 2/, etc.
- Use line breaks within tweets for readability
- End with a summary or CTA tweet
- Aim for 8-15 tweets total
- Be punchy and direct, not verbose

Return JSON with: "tweets" (array of strings, each under 280 characters)`,

  linkedin: `You are a LinkedIn thought leadership writer. Transform the given video transcript into a LinkedIn post.

Rules:
- Start with a hook line that stops the scroll
- Use short paragraphs (1-2 sentences each)
- Add line breaks between paragraphs for readability
- Include relevant insights and actionable takeaways
- End with a question or call to engagement
- Professional but conversational tone
- 800-1500 words max

Return JSON with: "content" (string — the full LinkedIn post)`,

  newsletter: `You are an email newsletter writer. Transform the given video transcript into an email newsletter edition.

Rules:
- Write a compelling subject line
- Start with a brief personal intro/hook
- Present the key insights in a scannable format
- Use bullet points and bold text for emphasis
- Include a TL;DR section at the top
- End with a CTA or question
- Conversational, direct tone

Return JSON with: "subject" (string — email subject line), "content" (string — the newsletter body in markdown)`,

  youtube: `You are a YouTube SEO expert. Create an optimized YouTube video description from the given transcript.

Rules:
- First 2 lines: compelling summary (these show in search results)
- Include timestamps/chapters section
- List key topics covered
- Include relevant keywords naturally
- Add placeholder lines for links (e.g., "[Link to resource mentioned]")
- Keep under 5000 characters

Return JSON with: "description" (string — the full YouTube description)`,

  shownotes: `You are a podcast producer. Create detailed show notes from the given transcript.

Rules:
- Episode summary (2-3 sentences)
- Key topics discussed with timestamps
- Notable quotes from the episode
- Resources or references mentioned
- Guest information if applicable
- Clean, well-organized markdown format

Return JSON with: "content" (string — the show notes in markdown)`,

  facebook: `You are a social media expert specializing in Facebook engagement. Transform the given video transcript into a Facebook post.

Rules:
- Start with a scroll-stopping hook or question
- Write in a warm, conversational tone that invites comments
- Use short paragraphs with line breaks for mobile readability
- Include a personal angle or story element when possible
- Add 2-3 relevant emoji sparingly for visual breaks
- End with a clear call to action or question to drive engagement
- Keep between 300-800 words (Facebook rewards longer, meaningful posts)
- Do NOT use hashtags excessively — 0 to 3 max at the end

Return JSON with: "content" (string — the full Facebook post)`,
};

const ALLOWED_TONES = { professional: 'professional', casual: 'casual', bold: 'bold' };
const ALLOWED_LENGTHS = {
  short: 'Keep it concise and brief — roughly half the normal length.',
  medium: 'Use a moderate, standard length.',
  long: 'Be comprehensive and detailed — roughly 50% longer than normal.',
};

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (await requirePro(req, res)) return;

  const { transcript, format, tone, length } = req.body || {};

  if (!transcript || typeof transcript !== 'string' || transcript.trim().length < 50) {
    return res.status(400).json({ error: 'Transcript text is required (minimum 50 characters).' });
  }
  if (!format || !FORMAT_PROMPTS[format]) {
    return res.status(400).json({ error: 'Invalid format. Choose from: ' + Object.keys(FORMAT_PROMPTS).join(', ') });
  }

  try {
    let systemPrompt = FORMAT_PROMPTS[format];
    if (tone && ALLOWED_TONES[tone]) {
      systemPrompt += '\n\nTone: Write in a ' + ALLOWED_TONES[tone] + ' tone.';
    }
    if (length && ALLOWED_LENGTHS[length]) {
      systemPrompt += '\n\nLength: ' + ALLOWED_LENGTHS[length];
    }

    const result = await callGemini(systemPrompt, transcript, 0.7);
    return res.status(200).json({ format, ...result });
  } catch (error) {
    console.error('Repurpose error:', error);
    const status = error.message.includes('AI service') ? 502 : 500;
    return res.status(status).json({ error: error.message || 'Internal server error' });
  }
}
