// api/_prompts.js — Shared format prompts for AI generation
// Vercel ignores _-prefixed files in api/ as endpoints.

// ============================================
// UNIVERSAL RULES — prepended to every format
// ============================================
export const UNIVERSAL_RULES = `## Ground rules (apply to EVERY output)

You are NOT reviewing, summarising, or reacting to a video. You are taking the IDEAS from a transcript and rewriting them as ORIGINAL CONTENT the user will publish under their own name on their own social accounts. The source video does not exist as far as the reader is concerned.

1. **Strip the source. Keep the idea.** Use the transcript ONLY as raw material — ideas, insights, frameworks, mental models, lessons. Never reveal it came from a video. Never let the reader sense a transcript was involved.

2. **NEVER name people from the transcript.** If the transcript says "Alex lost 45 pounds" or "Mike found that..." — DROP the names entirely. Rewrite as "I lost 45 pounds" or "Someone I know lost 45 pounds" or as a general observation. The only exception is well-known public figures (e.g. "Steve Jobs", "Buffett") used as a famous example that the user could plausibly reference themselves.

3. **NEVER reference the video or speaker.** Banned constructions: "in this video", "the speaker", "the conversation", "the podcast", "they said", "he shared", "she explains", "Alex said", "the guest mentioned", "the interview", "according to him". The user did not watch anything — they are sharing a take.

4. **First person by default.** Stories, struggles, and examples from the transcript get rewritten as "I" or "we" where natural. "I went through a phase where I got obsessed with calories" — NOT "Alex talked about getting obsessed with calories." Make the experience the writer's own.

5. **No verbatim quotes from the transcript.** Paraphrase every idea into the user's voice. Word-for-word lifts give away the source. (The single exception is the Key Quotes format, which is for the user's private inspiration board, not for posting as their own writing.)

6. **Specific beats abstract — but reframe the specifics.** "$400 on the wrong supplement" is a great detail, but rewrite as "I once burned $400 on the wrong supplement" or "A friend of mine wasted $400 on..." — never "he spent $400". The concrete carries the post; the attribution gets stripped.

7. **Banned phrases.** Do NOT use any of: "in today's world", "in this video", "the key is", "the secret is", "it's important to note", "the journey of", "unlock", "leverage" (as a verb), "breakthrough", "game-changer", "level up", "elevate", "transformation", "embrace", "harness", "delve", "the conversation highlighted", "the speaker discusses", "the video explores", "shift our identity", "common dilemma", "shared", "discussed", "talked about", "mentioned that", "pointed out", "explained how", "interesting perspective".

8. **Length discipline.** Stay within the word budget for each format. Cut filler before going over.

9. **Three variations means three real angles.** Each variation must have a DIFFERENT spine — not three rewordings of the same point. Vary the angle, the example, the emotional register.
`;

export const FORMAT_PROMPTS = {
  twitter: {
    prompt: `## Twitter/X Thread

Structure:
- Tweet 1 = HOOK. One bold, specific line that creates curiosity. NOT a summary. Use a scene, a number, a paradox, or a contrarian claim — rewritten as if it's the writer's own observation.
- Tweets 2-N = each tweet carries ONE idea, paraphrased from the transcript into the writer's own voice. No attribution. No "he said". No names.
- Final tweet = a punchline or one-line takeaway, OR a single question. Not "follow for more".

Rules:
- 6-12 tweets total. Quality > length.
- Each tweet under 280 chars (count yourself, leave 10 char buffer).
- Number tweets "1/", "2/", etc.
- Short sentences. Line breaks inside tweets where it adds punch.
- First person where it adds force ("I", "we", "you").
- No emojis unless they sharpen a point. No hashtags inside the thread.`,
    schema: '"twitter": { "tweets": ["tweet1", "tweet2", ...] }',
  },

  linkedin: {
    prompt: `## LinkedIn Posts (3 variations — distinct angles)

Generate 3 posts. The 3 angles MUST be different from each other. Each post reads as the WRITER'S own thinking — no reference to a video, no names from the transcript.

- **Variation 1 — Counter-intuitive insight**: Take one claim from the transcript that would surprise a thoughtful reader. Present it as the writer's own conclusion. Defend or unpack it.
- **Variation 2 — Personal-stake story**: Open with "I" or "I was" — rewrite a specific moment from the transcript as if it happened to the writer. Tell it like a short story with a turn at the end.
- **Variation 3 — Tactical framework**: Pull out a concrete method, rule, or step from the transcript. Title it. Show how it works using a reframed example (no names, no "the speaker says").

Structure for EACH post:
- Hook line (one short sentence, ideally under 12 words). NOT a question for variation 1 or 3.
- Body in short paragraphs of 1-2 sentences each, with blank lines between.
- 150-300 words total. Don't pad to look longer.
- End with EITHER a sharp one-line takeaway OR a single specific question (not "what do you think?").

Label each variation with a 2-5 word angle name (e.g., "Counter-intuitive take", "Personal story", "The X framework").`,
    schema: '"linkedin": [{ "label": "angle name", "content": "full linkedin post" }, { "label": "angle name", "content": "full linkedin post" }, { "label": "angle name", "content": "full linkedin post" }]',
  },

  facebook: {
    prompt: `## Facebook Posts (3 variations — distinct angles)

Facebook readers want stories and conversation, NOT LinkedIn-style lessons or motivational fluff. Each post is the WRITER'S own story or take — never "this guy said" or "I watched a video where".

The 3 angles MUST be different:
- **Variation 1 — Story/scene**: Take a specific moment from the transcript and rewrite it as something the writer witnessed or experienced themselves. No names. Land the insight at the end.
- **Variation 2 — Relatable struggle**: Open with a feeling or problem ("Ever lost weight and then become obsessed with the calorie count?"). Use the transcript's framing as raw material but write it as the WRITER's own observation about the problem and the way out.
- **Variation 3 — One bold statement unpacked**: Open with ONE striking line (paraphrased from the transcript into the writer's voice, NOT a quote from anyone). Then 2-3 short paragraphs of the writer's own reflection on it.

Structure for EACH post:
- Hook line (curiosity, scene, or bold statement — NOT a generic question like "Have you ever wondered...").
- Conversational, warm tone. "I" voice where it fits.
- Short paragraphs with blank lines between.
- 120-250 words. Cut filler before adding more.
- 0-2 emoji, only if they earn their place. Hashtags: 0-2 max, specific not generic (no #motivation, #inspiration).
- End with ONE question OR a one-line landing — not both.

Label each variation with a 2-5 word angle name.`,
    schema: '"facebook": [{ "label": "angle name", "content": "full facebook post" }, { "label": "angle name", "content": "full facebook post" }, { "label": "angle name", "content": "full facebook post" }]',
  },

  instagram: {
    prompt: `## Instagram Captions (3 variations — distinct angles)

Each caption reads as the WRITER's own thought. No "in this video", no names, no attribution.

The 3 angles MUST be different:
- **Variation 1 — One-line truth + story**: First line is a bold statement (paraphrased from the transcript into the writer's voice). Then 3-5 short paragraphs unpacking it with a specific scene — reframed as the writer's own experience or observation, no names.
- **Variation 2 — Numbered list**: Pull 3-5 specific points or steps from the transcript. Rewrite each as a short punchy line in the writer's voice. Concrete, not abstract.
- **Variation 3 — Confession/relatable hook**: Open with "I used to..." or "Nobody talks about..." — tied to something the transcript reframes. Walk through the reframe as the writer's own realisation.

Structure for EACH caption:
- First line must work as a standalone preview (Instagram truncates after ~125 chars).
- Use line breaks generously — Instagram captions read as visual blocks.
- 80-180 words total before the hashtags.
- Hashtags: 8-12 RELEVANT to the topic (not the platform). Skip generic ones like #motivation, #life, #love unless they're genuinely on-topic.
- One emoji per paragraph maximum.

Label each variation with a 2-5 word angle name.`,
    schema: '"instagram": [{ "label": "angle name", "content": "full instagram caption" }, { "label": "angle name", "content": "full instagram caption" }, { "label": "angle name", "content": "full instagram caption" }]',
  },

  tiktok: {
    prompt: `## TikTok Posts (3 variations — distinct angles)

For each, write a CAPTION (under 200 chars, conversational, no listicle vibe) and a VOICEOVER SCRIPT (spoken-word, 30-50 seconds at natural pace, around 80-130 words). The script is spoken by the WRITER as their own take — never "this guy said" or "I saw a video where".

The 3 angles MUST be different:
- **Variation 1 — Hot take**: Lead with a punchy contrarian claim (paraphrased from the transcript, delivered as the writer's own stance). Defend it in 20 seconds.
- **Variation 2 — Story-driven**: Recount a specific scene from the transcript REFRAMED as something the writer witnessed or experienced. No names. Reveal the insight through the story.
- **Variation 3 — Tactic/how-to**: Pull a concrete method from the transcript. Explain it in 3 steps as the writer's own recommendation.

Script rules:
- Write for the EAR. Contractions, short sentences, rhythm.
- First sentence MUST stop the scroll. No "Today I'm gonna talk about..." opens.
- No filler ("so", "basically", "kind of"). Cut every word that doesn't carry weight.
- End with one concrete next step — comment a word, save, try X tomorrow.

Caption rules:
- Hook-y, not summarising.
- 4-6 hashtags total. Mix one broad (#fitness) with topic-specific ones (#caloriedeficit, #atomichabits).

Label each variation with a 2-5 word angle name.`,
    schema: '"tiktok": [{ "label": "angle name", "caption": "short tiktok caption with hashtags", "script": "voiceover script" }, { "label": "angle name", "caption": "short tiktok caption with hashtags", "script": "voiceover script" }]',
  },

  blog: {
    prompt: `## Blog Posts (3 variations — distinct angles)

Each post is the WRITER'S own essay. No "according to the speaker", no names from the transcript, no "in this video I watched". The ideas appear as the writer's own thinking.

The 3 angles MUST be different:
- **Variation 1 — Specific deep dive**: Pick ONE narrow idea from the transcript and write the definitive short post about it from the writer's POV. Title must be specific, not "How to X".
- **Variation 2 — Reframe/contrarian piece**: Lead with the conventional wisdom the transcript pushes back on. Use the transcript's argument to flip it, in the writer's voice.
- **Variation 3 — Practical playbook**: Step-by-step or framework format. Each step grounded in something the transcript actually says, but presented as the writer's own method.

Structure for EACH post:
- Specific, click-worthy title — avoid clickbait, avoid "Ultimate Guide". A real reader should know what they're getting.
- Brief intro (2-3 sentences) that names the problem or the stake.
- 3-5 H2 sub-headings (## in markdown) that map the actual structure of the argument.
- Short paragraphs, plain prose. Use concrete examples — but reframe them as the writer's own observations or general illustrations (no names from the transcript, no verbatim quotes from it).
- Closing section with one specific takeaway — not a generic "key takeaways" recap.
- 400-700 words. Markdown formatting throughout (##, ###, **bold**, blockquotes where useful).

Label each variation with a 2-5 word angle name.`,
    schema: '"blog": [{ "label": "angle name", "title": "blog headline", "content": "full blog post in markdown" }, { "label": "angle name", "title": "blog headline", "content": "full blog post in markdown" }, { "label": "angle name", "title": "blog headline", "content": "full blog post in markdown" }]',
  },

  quotes: {
    prompt: `## Key Quotes (for the user's private inspiration board)

NOTE: This format is the ONE EXCEPTION to the "no verbatim quotes" rule. These are pulled for the user to save, reflect on, or rework later — they are NOT meant to be posted as the user's own writing.

Extract 5-10 of the most striking standalone lines from the transcript. Rules:
- Verbatim or near-verbatim. Light cleanup of "uh", "you know", false starts is fine — rewording is not.
- Each quote must STAND ALONE — make sense without surrounding context.
- Pick quotes that are surprising, contrarian, vivid, or have a turn — not generic motivational lines.
- Do NOT include names. If the transcript says "Alex believes X", strip to "X". Just the line.
- Include the timestamp [MM:SS] if you can identify the moment in the transcript.
- For each quote, also write a "tweet" version: same idea, paraphrased into the user's own voice (so it's safe to post as original), tightened to under 280 chars.`,
    schema: '"quotes": [{ "text": "the quote", "timestamp": "MM:SS or empty", "tweet": "paraphrased tweetable version under 280 chars" }, ...]',
  },

  video_script: {
    prompt: `## Short-Form Video Scripts (3 variations — flipped rewrites)

Generate 3 scripts. The transcript is raw material; the scripts are the WRITER speaking as themselves. No "I watched a video where..." opens. No names from the transcript.

The 3 angles MUST be different:
- **Variation 1 — Contrarian take**: Open with a claim that challenges what most people think about this topic. Deliver as the writer's own stance.
- **Variation 2 — Beginner framing**: Assume the viewer is new to this. Strip jargon. Use one specific example — reframed as the writer's own observation, no names.
- **Variation 3 — Story / case study**: Lead with a specific scene or moment from the transcript, REFRAMED as something the writer witnessed or went through. Reveal the insight through the story.

Structure for EACH script:
1. **HOOK** (first 1-3 seconds spoken — roughly 8-15 words): bold claim, pattern interrupt, provocative question, or unexpected fact. Must stop a scroller cold.
2. **VALUE** (the substance — 80-130 words of spoken-word script): short punchy sentences, contractions, natural cadence. Carry ONE clear idea from intro to landing. No filler ("so", "basically", "the thing is").
3. **CTA** (one concrete next step): follow, save, try X tomorrow, comment a specific word. Specific > generic.

Also include:
- "on_screen_text": 3-6 short caption overlays (under 6 words each) timed to key script moments.
- "b_roll": 3-6 short visual cues ("close-up of phone", "split-screen before/after", "person walking past camera") suggesting what to film/cut to.

Total spoken script (hook + value + cta) MUST be under 160 words (≈ 60 seconds at natural pace).

Label each variation with a 2-5 word angle name.`,
    schema: '"video_script": [{ "label": "angle name", "hook": "first 1-3 seconds", "value": "main body of the script", "cta": "call to action", "on_screen_text": ["overlay 1", "overlay 2"], "b_roll": ["visual cue 1", "visual cue 2"] }, { "label": "angle name", "hook": "...", "value": "...", "cta": "...", "on_screen_text": [...], "b_roll": [...] }, { "label": "angle name", "hook": "...", "value": "...", "cta": "...", "on_screen_text": [...], "b_roll": [...] }]',
  },
};

export const VALID_FORMATS = Object.keys(FORMAT_PROMPTS);
