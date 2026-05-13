// api/_prompts.js — Shared format prompts for AI generation
// Vercel ignores _-prefixed files in api/ as endpoints.

// ============================================
// UNIVERSAL RULES — prepended to every format
// ============================================
export const UNIVERSAL_RULES = `## Ground rules (apply to EVERY output)

1. **Stay grounded.** Every claim, quote, and example MUST come from something specifically said in the transcript. If the transcript doesn't say it, don't write it. Paraphrasing is fine; inventing details, statistics, or quotes is not.

2. **Quote, don't summarise.** Where possible, lift the speaker's actual phrasing. A specific line beats a polished paraphrase.

3. **Specific beats abstract.** "He spent $400 on the wrong thing" beats "He had a setback." Concrete details and named moments from the transcript carry the post — not platitudes.

4. **Banned phrases.** Do NOT use any of: "in today's world", "in this video", "the key is", "the secret is", "it's important to note", "the journey of", "unlock", "leverage" (as a verb), "breakthrough", "game-changer", "level up", "elevate", "transformation", "embrace", "harness", "delve", "the conversation highlighted", "the speaker discusses", "the video explores", "shift our identity", "common dilemma".

5. **No meta-references.** Don't say "this video" or "the speaker says" or "in the conversation". Write as if YOU are sharing what you learned/believe — first person where natural.

6. **Length discipline.** Stay within the word budget for each format. Cut filler before going over.

7. **Three variations means three real angles.** Each variation must have a DIFFERENT spine — not three rewordings of the same point. Vary the angle, the example, the emotional register.
`;

export const FORMAT_PROMPTS = {
  twitter: {
    prompt: `## Twitter/X Thread

Structure:
- Tweet 1 = HOOK. One bold, specific line that creates curiosity. NOT a summary. NOT "Here are 5 lessons from..." Use a scene, a number, a paradox, or a contrarian claim from the transcript.
- Tweets 2-N = each tweet carries ONE idea, lifted or paraphrased from the transcript. Use the speaker's actual examples and phrasing where possible.
- Final tweet = a punchline or one-line takeaway, OR a single question. Not "follow for more".

Rules:
- 6-12 tweets total. Quality > length.
- Each tweet under 280 chars (count yourself, leave 10 char buffer).
- Number tweets "1/", "2/", etc.
- Short sentences. Line breaks inside tweets where it adds punch.
- No emojis unless they sharpen a point. No hashtags inside the thread.`,
    schema: '"twitter": { "tweets": ["tweet1", "tweet2", ...] }',
  },

  linkedin: {
    prompt: `## LinkedIn Posts (3 variations — distinct angles)

Generate 3 posts. The 3 angles MUST be different from each other:
- **Variation 1 — Counter-intuitive insight**: Pick the one claim from the transcript that would surprise a thoughtful reader. Frame the post around defending or unpacking it.
- **Variation 2 — Personal-stake story**: Open with a "I" or "I was" line that connects to a specific moment in the transcript. Tell it like a short story with a turn at the end.
- **Variation 3 — Tactical framework**: Pull out a concrete method, rule, or step from the transcript. Title it. Show how it works using the transcript's own example(s).

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

Facebook readers want stories and conversation, NOT LinkedIn-style lessons or motivational fluff.

The 3 angles MUST be different:
- **Variation 1 — Story/scene**: Open with a specific moment from the transcript ("They asked him why he wasn't 200 pounds heavier..."). Tell it like you're recounting a conversation you overheard. Land the insight at the end.
- **Variation 2 — Relatable struggle**: Open with a feeling or problem the transcript names directly ("Ever lost weight and then become obsessed with the calorie count?"). Use the speaker's own framing to explain why it happens, then offer their take on the way out.
- **Variation 3 — Single quote unpacked**: Lift ONE striking line from the transcript verbatim, put it in quotes at the top, then write 2-3 short paragraphs of your own reaction/reflection.

Structure for EACH post:
- Hook line (curiosity, scene, or quote — NOT a generic question like "Have you ever wondered...").
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

The 3 angles MUST be different:
- **Variation 1 — One-line truth + story**: First line is a single bold statement pulled from the transcript. Then 3-5 short paragraphs unpacking it with a specific scene or example from the transcript.
- **Variation 2 — Numbered list**: Pull 3-5 specific points or steps the transcript actually names. One short line each. Concrete, not abstract.
- **Variation 3 — Confession/relatable hook**: Open with "I used to..." or "Nobody talks about..." — tied to something the transcript reframes. Walk through the reframe.

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

For each, write a CAPTION (under 200 chars, conversational, no listicle vibe) and a VOICEOVER SCRIPT (spoken-word, 30-50 seconds at natural pace, around 80-130 words).

The 3 angles MUST be different:
- **Variation 1 — Hot take**: Lead the script with a punchy contrarian claim from the transcript. Defend it in 20 seconds.
- **Variation 2 — Story-driven**: Recount a specific scene or exchange from the transcript ("This guy asked him why he wasn't 200 pounds heavier and the answer changed how I think about willpower").
- **Variation 3 — Tactic/how-to**: Pull a concrete method from the transcript. Explain it in 3 steps.

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

The 3 angles MUST be different:
- **Variation 1 — Specific deep dive**: Pick ONE narrow idea from the transcript and write the definitive short post about it. Title must be specific, not "How to X".
- **Variation 2 — Reframe/contrarian piece**: Lead with the conventional wisdom the transcript pushes back on. Use the transcript's argument to flip it.
- **Variation 3 — Practical playbook**: Step-by-step or framework format. Each step grounded in something the transcript actually says.

Structure for EACH post:
- Specific, click-worthy title — avoid clickbait, avoid "Ultimate Guide". A real reader should know what they're getting.
- Brief intro (2-3 sentences) that names the problem or the stake.
- 3-5 H2 sub-headings (## in markdown) that map the actual structure of the argument.
- Short paragraphs, plain prose. Quote the speaker at least once (verbatim, in blockquote or inline).
- Closing section with one specific takeaway — not a generic "key takeaways" recap.
- 400-700 words. Markdown formatting throughout (##, ###, **bold**, blockquotes where useful).

Label each variation with a 2-5 word angle name.`,
    schema: '"blog": [{ "label": "angle name", "title": "blog headline", "content": "full blog post in markdown" }, { "label": "angle name", "title": "blog headline", "content": "full blog post in markdown" }, { "label": "angle name", "title": "blog headline", "content": "full blog post in markdown" }]',
  },

  quotes: {
    prompt: `## Key Quotes

Extract 5-10 of the most striking standalone lines from the transcript. Rules:
- Verbatim or near-verbatim. Keep the speaker's words. Light cleanup of "uh", "you know", false starts is fine — rewording is not.
- Each quote must STAND ALONE — make sense without the surrounding context.
- Pick quotes that are surprising, contrarian, vivid, or have a turn — not generic motivational lines.
- Include the timestamp [MM:SS] if you can identify the moment in the transcript.
- For each quote, also write a "tweet" version: same idea, tightened to under 280 chars, optimised for sharing. Can be slightly rephrased.`,
    schema: '"quotes": [{ "text": "the quote", "timestamp": "MM:SS or empty", "tweet": "tweetable version under 280 chars" }, ...]',
  },

  video_script: {
    prompt: `## Short-Form Video Scripts (3 variations — flipped rewrites)

Generate 3 scripts. DO NOT copy the transcript's wording — these are FRESH rewrites of the core idea in a new voice and structure.

The 3 angles MUST be different:
- **Variation 1 — Contrarian take**: Open with a claim that challenges what most people think about this topic. Use the transcript's argument as backing.
- **Variation 2 — Beginner framing**: Assume the viewer is new to this. Strip jargon. Use one specific example from the transcript.
- **Variation 3 — Story / case study**: Lead with a specific person, scene, or moment from the transcript. Reveal the insight through the story.

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
