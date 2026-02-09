// api/repurpose.js
// Content Repurposer endpoint — transforms transcripts into various content formats.
// Set OPENAI_API_KEY in Vercel environment variables.

const OPENAI_KEY = process.env.OPENAI_API_KEY || '';

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

  const { transcript, format, tone, length } = req.body || {};

  if (!transcript || typeof transcript !== 'string' || transcript.trim().length < 50) {
    return res.status(400).json({ error: 'Transcript text is required (minimum 50 characters).' });
  }

  if (!format || !FORMAT_PROMPTS[format]) {
    return res.status(400).json({
      error: 'Invalid format. Choose from: ' + Object.keys(FORMAT_PROMPTS).join(', '),
    });
  }

  if (!OPENAI_KEY) {
    return res.status(500).json({ error: 'OpenAI API key is not configured. Set OPENAI_API_KEY in environment variables.' });
  }

  try {
    let text = transcript.trim();
    if (text.length > 120000) {
      text = text.substring(0, 120000) + '\n\n[Transcript truncated]';
    }

    let systemPrompt = FORMAT_PROMPTS[format];

    if (tone) {
      systemPrompt += '\n\nTone: Write in a ' + tone + ' tone.';
    }
    if (length) {
      const lengthGuide = {
        short: 'Keep it concise and brief — roughly half the normal length.',
        medium: 'Use a moderate, standard length.',
        long: 'Be comprehensive and detailed — roughly 50% longer than normal.',
      };
      if (lengthGuide[length]) {
        systemPrompt += '\n\nLength: ' + lengthGuide[length];
      }
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
        temperature: 0.7,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('OpenAI API error:', response.status, err);
      return res.status(502).json({ error: 'AI service error. Please try again.' });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return res.status(502).json({ error: 'Empty response from AI service.' });
    }

    const result = JSON.parse(content);
    return res.status(200).json({ format, ...result });

  } catch (error) {
    console.error('Repurpose error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
