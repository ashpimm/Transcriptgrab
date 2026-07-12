// api/_generate.js — Carousel generation core, shared by the create page
// endpoint (api/carousel.js) and the autopilot cron (api/autopilot.js).
// Vercel ignores _-prefixed files in api/ as endpoints.

import { getAutoHookPool, getCuratedHookPool, getHooksByIds } from './_db.js';
import { callGemini } from './_shared.js';
import { CAROUSEL_COPY_PROMPT } from './_prompts.js';

export const SLIDE_COUNT = 6;

// The accent is always the USER'S brand color — Hooklab orange must never
// leak into customer output. No color known -> neutral that fits the style.
export const NEUTRAL_ACCENT = { bold: '#F5F5F6', mono: '#141414', notebook: '#20232B', stat: '#F5F5F6' };

export function validHex(c) {
  return /^#[0-9a-fA-F]{6}$/.test(c || '') ? c : '';
}

export function resolveAccent(style, profile, override) {
  return validHex(override) || validHex(profile?.color) || NEUTRAL_ACCENT[style] || NEUTRAL_ACCENT.bold;
}

export function cleanMotifs(motifs) {
  return (Array.isArray(motifs) ? motifs : [])
    .map((m) => String(m).replace(/[^\w\s',-]/g, '').trim().substring(0, 60))
    .filter(Boolean)
    .slice(0, 5);
}

// Style descriptors keep slide-to-slide consistency: same descriptor + slide
// number is the whole prompt, so a set reads as one designed carousel.
export const STYLES = {
  bold: 'Bold typographic social media slide: massive high-contrast sans-serif text on a deep charcoal (#101418) background with one ACCENT accent element per slide. Swiss poster energy. Flat, no photos, no gradients busier than two stops.',
  mono: 'Minimal black-and-white editorial slide: off-white (#FAFAF7) paper background, large tight black grotesque type, one thin underline accent. Lots of whitespace. No images, no color.',
  notebook: 'Hand-drawn notebook style slide: cream paper texture, handwritten-style marker lettering in dark ink, small doodle underlines and arrows, one ACCENT circled highlight. Feels like smart lecture notes.',
  stat: 'Dark data-card slide: near-black background, big monospace-style numerals and labels, thin grid lines, one glowing ACCENT stat highlight. Feels like a terminal dashboard turned into a poster.',
};

// One TEXTLESS background per carousel — the client draws razor-sharp text
// over it on canvas. Image models mangle small text; canvas never does.
export const BG_STYLES = {
  bold: 'Deep charcoal (#101418) abstract composition, one large ACCENT geometric shape, subtle grain, Swiss poster energy. Flat and minimal.',
  mono: 'Off-white (#FAFAF7) paper texture, faint black editorial geometry near the edges, huge whitespace, no color.',
  notebook: 'Cream lined notebook paper, faint hand-drawn ink doodles, arrows and underlines around the edges, one ACCENT circled scribble.',
  stat: 'Near-black terminal dashboard aesthetic: thin grid lines, faint glowing ACCENT data traces and chart fragments near the edges.',
};

export function backgroundPrompt(style, profile, motifs, accentOverride) {
  const accent = resolveAccent(style, profile, accentOverride);
  const base = (BG_STYLES[style] || BG_STYLES.bold).split('ACCENT').join(accent);
  const about = [profile?.name, profile?.what].filter(Boolean).join(': ').substring(0, 300);
  const motifLine = motifs && motifs.length
    ? `Weave in stylized illustrated motifs of: ${motifs.join(', ')} — abstract and decorative, near the edges, never literal screenshots or UI.`
    : `Weave in subtle abstract visual motifs related to the app's subject matter (never literal screenshots or UI).`;
  return `Textless background art for a social media carousel promoting an app. The app: ${about || 'a software product'}.
${base}
${motifLine} Keep the middle of the canvas quiet and empty for a text overlay.
Portrait 4:5. ABSOLUTELY NO text, no letters, no numbers, no words, no logos.`;
}

// 75% value listicles, 25% direct app showcase, deterministic by post count.
export function postKind(n) {
  return n % 4 === 3 ? 'showcase' : 'value';
}

// Daily posting slots at 15:00 UTC (peak US morning/noon). Window is the
// next `days` consecutive calendar days starting today (or tomorrow if
// today's 15:00 slot has already passed); days already taken in `existing`
// are dropped rather than backfilled from beyond the window.
export function nextSlots(nowIso, existing, days) {
  const now = new Date(nowIso);
  const takenDays = new Set(existing.map((d) => new Date(d).toISOString().substring(0, 10)));

  const start = new Date(now);
  start.setUTCHours(15, 0, 0, 0);
  if (start <= now) start.setUTCDate(start.getUTCDate() + 1);

  const out = [];
  for (let i = 0; i < days; i++) {
    const slot = new Date(start);
    slot.setUTCDate(slot.getUTCDate() + i);
    if (takenDays.has(slot.toISOString().substring(0, 10))) continue;
    out.push(slot);
  }
  return out;
}

export function buildPlanPayload({ profile, hook, kind, slideCount }) {
  return {
    app: {
      name: profile.name || '',
      what: profile.what,
      who: profile.who || '',
      benefit: profile.benefit || '',
      tone: profile.tone || 'casual',
    },
    audienceNiche: profile.audience_niche?.name || 'General',
    hook: { template: hook.hook_template, verbatim: hook.hook_verbatim || '', topic: hook.topic || '' },
    kind: kind === 'showcase' ? 'showcase' : 'value',
    slideCount,
  };
}

async function pickHook(profile, hookId) {
  if (Number.isInteger(hookId) && hookId > 0) {
    const found = (await getHooksByIds([hookId]))[0];
    if (found) return found;
  }
  const nicheSlug = profile.audience_niche?.slug || 'appdev';
  let pool = await getAutoHookPool(nicheSlug, 10);
  if (pool.length === 0) pool = await getCuratedHookPool(12); // cold niche: portable curated patterns
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

export async function generateCarouselPlan({ profile, kind = 'value', hookId = null, styleOverride = '' }) {
  const hook = await pickHook(profile, hookId);
  if (!hook) throw new Error('No hooks available yet — try again shortly.');

  const styleKeys = Object.keys(STYLES);
  const style = STYLES[styleOverride] ? styleOverride : styleKeys[Math.floor(Math.random() * styleKeys.length)];

  const payload = buildPlanPayload({ profile, hook, kind, slideCount: SLIDE_COUNT });
  const out = await callGemini(CAROUSEL_COPY_PROMPT, JSON.stringify(payload), 0.7);
  if (!out || !Array.isArray(out.slides) || out.slides.length === 0) {
    throw new Error('AI returned an invalid response. Please try again.');
  }

  const slides = out.slides.slice(0, SLIDE_COUNT).map((s, i) => ({
    index: i,
    heading: String(s.heading || '').substring(0, 120),
    body: String(s.body || '').substring(0, 220),
  }));
  const hashtags = (Array.isArray(out.hashtags) ? out.hashtags : [])
    .map((h) => String(h).replace(/^#/, '').replace(/[^a-z0-9_]/gi, '').toLowerCase())
    .filter(Boolean).slice(0, 8);
  let caption = String(out.caption || '').substring(0, 1000);
  if (hashtags.length > 0) caption = caption + '\n\n' + hashtags.map((h) => '#' + h).join(' ');

  return {
    hook, style, slides, caption,
    motifs: cleanMotifs(out.motifs),
    accent: validHex(profile.color),
  };
}
