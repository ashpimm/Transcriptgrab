// api/_prompts.js — Hooklab AI prompts.
// Vercel ignores _-prefixed files in api/ as endpoints.

// ============================================
// HOOK EXTRACTION (mining pipeline)
// ============================================
export const HOOK_EXTRACTION_PROMPT = `You are a short-form content researcher. You receive a JSON object: { niche: "<the creator audience being researched>", videos: [...] }. Each video has: i (index), title, views, followers, and sometimes transcript (the spoken words).

For EACH video, extract its hook and metadata. The hook is the attention-grabbing opening line: use the first sentence of the transcript if available, otherwise infer from the title.

Return ONLY a JSON array, one object per input video:
[{
  "i": 0,
  "relevant": true,
  "hook_verbatim": "the actual opening line or title-derived hook",
  "hook_template": "the same hook with specifics replaced by ___ slots",
  "topic": "3-8 word topic summary",
  "format": "talking_head"
}]

Rules:
- relevant: true ONLY if a creator in the given niche could credibly post content in this video's pattern about their own work. Keyword search is noisy — a niche of "App Developers & SaaS" will surface Minecraft builds, toy hauls, city-government clips, random vlogs. Those are relevant: false. When unsure, false.
- If relevant is false, you may leave the other fields as empty strings.
- hook_verbatim must be a complete, self-contained line someone would say to camera. Fragments like "Ah." or half-sentences are not hooks — mark those videos relevant: false.
- hook_template: replace names, numbers, niches, and product-specifics with ___ slots. Example: "How I took my client from 150 to 130 lbs in 8 weeks" becomes "How I took my client from ___ to ___ in ___". Keep the sentence structure and emotional punch intact.
- Keep templates under 20 words.
- format must be one of: talking_head, whiteboard, audio_broll, skit, other. Without visual evidence default to talking_head.
- topic is plain lowercase, no hashtags.
- Output raw JSON array only. No markdown fences, no commentary.`;

// ============================================
// APP PROFILE (scraped URL -> structured app profile)
// ============================================
export const APP_PROFILE_PROMPT = `You receive scraped text from an app's landing page, Play Store page, or App Store page. Extract a structured profile of the app for marketing content.

Return ONLY this JSON object:
{
  "name": "the app's name",
  "what": "1-2 sentences: what the app is and what it does, in plain words",
  "who": "1 sentence: who it is for",
  "benefit": "1 sentence: the single biggest concrete benefit or outcome for the user",
  "tone": "casual",
  "color": "#RRGGBB"
}

Rules:
- Use only facts present in the text. Never invent features, numbers, or claims.
- benefit must be the sharpest, most specific outcome in the text (a number, a time saved, a pain removed). If several exist, pick the strongest one.
- tone must be one of: casual, professional, funny, authority — infer from the writing style of the source.
- color: the app's brand/accent color as a 6-digit hex if the text names or strongly implies one; otherwise pick a saturated accent that fits the app's subject (e.g. green for nutrition, blue for finance). Never white, black, or gray.
- Output raw JSON only. No markdown fences.`;

// ============================================
// CAROUSEL (app profile + hook -> slides + caption + hashtags)
// ============================================
export const CAROUSEL_COPY_PROMPT = `You write faceless carousel posts (Instagram/TikTok image slides) that market an app. You receive JSON with:
- app: { name, what, who, benefit, tone }
- hook: { template, verbatim, topic }
- slideCount: total slides (including hook slide and CTA slide)

Return ONLY this JSON object:
{
  "slides": [
    { "index": 0, "heading": "the adapted hook, max 12 words", "body": "" },
    { "index": 1, "heading": "short punchy heading", "body": "1-2 sentences of concrete value, max 30 words" }
  ],
  "caption": "2-3 sentences that make the reader want the app, ending with where to get it (use the app name, not a URL)",
  "hashtags": ["5-8 lowercase hashtags without the # symbol, mixing niche and reach tags"],
  "motifs": ["3-5 concrete drawable objects that visually represent this app's subject"]
}

Rules:
- Slide 0 is the hook slide: heading only, body empty. Fill the hook template's ___ slots with this app's specifics. It must create curiosity or name a pain app.who actually has.
- Middle slides each carry ONE concrete idea: the problem, how the app kills it, what app.benefit means day-to-day, proof or a vivid before/after. Pull only from app.what / app.who / app.benefit — never invent numbers, users, or results.
- Last slide is the CTA slide: heading tells the reader the single next step in plain words (e.g. "Try ${'{'}app name{'}'} free"), body empty.
- Headings max 12 words, bodies max 30 words. Text must fit on an image.
- Match app.tone: casual = contractions and plain talk; professional = tight and direct; funny = one honest joke maximum; authority = confident short declaratives.
- Banned: "here's the truth", "skyrocket", "game-changer", "unlock", "elevate", "delve". No em-dashes, no double hyphens, no emoji in slides.
- motifs: short noun phrases for physical objects an illustrator could draw about THIS app's subject (e.g. a workout app: "dumbbell", "progress ring", "calendar streak"). Never words like "app", "screen", "phone", "logo", "text", or abstract concepts.
- Output raw JSON only. No markdown fences.`;

// ============================================
// BRAND COLOR (fallback when profile save has none)
// ============================================
export const PICK_COLOR_PROMPT = `You receive JSON: { name, what } describing an app. Pick ONE saturated brand accent color that fits the app's subject (e.g. green for nutrition, blue for finance, red-pink for dating). Never white, black, gray, or orange (#FF4D00 is reserved).

Return ONLY: {"color": "#RRGGBB"}`;
