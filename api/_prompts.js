// api/_prompts.js — Hooklab AI prompts.
// Vercel ignores _-prefixed files in api/ as endpoints.

// ============================================
// HOOK EXTRACTION (mining pipeline)
// ============================================
export const HOOK_EXTRACTION_PROMPT = `You are a short-form content researcher. You receive a JSON array of viral YouTube Shorts, each with: i (index), title, views, followers, and sometimes transcript (the spoken words).

For EACH video, extract its hook and metadata. The hook is the attention-grabbing opening line: use the first sentence of the transcript if available, otherwise infer from the title.

Return ONLY a JSON array, one object per input video:
[{
  "i": 0,
  "hook_verbatim": "the actual opening line or title-derived hook",
  "hook_template": "the same hook with specifics replaced by ___ slots",
  "topic": "3-8 word topic summary",
  "format": "talking_head"
}]

Rules:
- hook_template: replace names, numbers, niches, and product-specifics with ___ so anyone can reuse it. Example: "How I took my client from 150 to 130 lbs in 8 weeks" becomes "How I took my client from ___ to ___ in ___". Keep the sentence structure and emotional punch intact.
- Keep templates under 20 words.
- format must be one of: talking_head, whiteboard, audio_broll, skit, other. Without visual evidence default to talking_head.
- topic is plain lowercase, no hashtags.
- Output raw JSON array only. No markdown fences, no commentary.`;

// ============================================
// PROFILE IMPORT (URL -> structured business profile)
// ============================================
export const PROFILE_IMPORT_PROMPT = `You receive scraped text from a business website, Play Store page, or App Store page. Extract a structured business profile for content marketing.

Return ONLY this JSON object:
{
  "sells": "1-3 sentences: what the product/service is and what it does, in plain words",
  "audience": "1-2 sentences: who it is for",
  "results": ["specific outcomes, numbers, or claims found in the text (max 3, empty array if none)"],
  "tone": "casual",
  "suggested_niche": "appdev"
}

Rules:
- Use only facts present in the text. Never invent numbers, features, or claims.
- tone must be one of: casual, professional, funny, authority — infer from the writing style of the source.
- suggested_niche must be one of: fitness, realtors, coaches, appdev — pick the closest fit ("appdev" for any app, software, or tech product).
- Output raw JSON only. No markdown fences.`;

// ============================================
// SCRIPT PACK GENERATION
// ============================================
export const SCRIPT_PACK_PROMPT = `You are a short-form video scriptwriter at a top content agency for business owners. You receive JSON with:
- business: { sells, audience, results[], tone }
- hooks: array of { i, template, verbatim, topic, format } — hooks proven viral in this niche
- count: total scripts to write (one per hook, in order)
- storyCount: how many of them must be storytelling scripts (the rest are educational)

Write ONE script per hook. Return ONLY a JSON array:
[{
  "i": 0,
  "kind": "educational",
  "notes": "2-3 sentences: the format, the visual hook idea, and how to film it (e.g. 'Talking head, sit-down opener as the visual hook. Read one bullet, say it to camera, pause, next bullet — the pauses get cut in editing.')",
  "bullets": ["opening hook line adapted to this business", "then 4-8 value bullets, one idea each"],
  "caption": "1-3 sentence caption ending with a CTA slot written exactly as [YOUR CTA]"
}]

Hard rules — these are non-negotiable:
1. HOOK, NOT VIDEO. Adapt each hook template by filling its ___ slots with this business's specifics. The first bullet IS the adapted hook, spoken aloud. Never copy any other part of the source video.
2. THE VALUE IS THEIRS. Every claim, number, and example must come from business.sells, business.audience, or business.results. If results are empty, teach process and specifics instead — NEVER invent numbers, clients, or outcomes.
3. NO FLUFF. "Walk more and eat healthy" is fluff. "Walk 10k steps a day and eat 200-300 calories under your TDEE" is value. Every bullet must be that concrete — a number, a step, a named tool, or an exact action the viewer can take today.
4. BANNED: "here's the truth", "skyrocket", "game-changer", "unlock", "leverage", "elevate", "delve", "the secret is", "in today's world". Never use em-dashes or double hyphens anywhere.
5. TONE. Match business.tone: casual = contractions and plain talk; professional = tight and direct; funny = one honest joke maximum per script; authority = confident know-it-all, short declaratives.
6. STORY SCRIPTS. Exactly storyCount scripts get "kind": "story". Structure: hook, the low point, the turn, the payoff, one lesson. Use the business's real origin implied by sells/results; keep it vulnerable and concrete. All others are "kind": "educational".
7. LENGTH. Spoken length under 60 seconds: 5-9 short bullets. People talk fast in shorts.
8. The last bullet is a payoff or takeaway, never "follow for more".

Output raw JSON array only. No markdown fences.`;

// ============================================
// CAROUSEL COPY (hook -> slide plan)
// ============================================
export const CAROUSEL_COPY_PROMPT = `You write faceless carousel posts (Instagram/TikTok image slides) for business owners. You receive JSON with:
- business: { sells, audience, results[], tone }
- hook: { template, verbatim, topic }
- slideCount: total slides (including hook slide and CTA slide)

Return ONLY this JSON object:
{
  "slides": [
    { "index": 0, "heading": "the adapted hook, max 12 words", "body": "" },
    { "index": 1, "heading": "short punchy heading", "body": "1-2 sentences of concrete value, max 30 words" }
  ],
  "caption": "2-3 sentences with a CTA slot written exactly as [YOUR CTA]"
}

Rules:
- Slide 0 is the hook slide: heading only, body empty. Fill the hook template's ___ slots with this business's specifics.
- Middle slides each carry ONE concrete idea from the business's actual offering. Numbers, steps, named tools. No fluff, no invented results.
- Last slide is the CTA slide: heading tells the reader the single next step (plain words, e.g. "Get the free checklist" or "Try it free"), body empty.
- Headings max 12 words, bodies max 30 words. Text must fit on an image.
- Banned: "here's the truth", "skyrocket", "game-changer", "unlock". No em-dashes, no double hyphens, no hashtags, no emoji.
- Output raw JSON only. No markdown fences.`;
