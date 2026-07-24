// api/_generate.js — Carousel generation core, shared by the create page
// endpoint (api/carousel.js) and the autopilot cron (api/autopilot.js).
// Vercel ignores _-prefixed files in api/ as endpoints.

import { getAutoHookPool, getGlobalHookPool, getHooksByIds } from './_db.js';
import { callGemini } from './_shared.js';
import { CAROUSEL_COPY_PROMPT, HOOK_PICK_PROMPT } from './_prompts.js';
import { NICHE_CLASSIFIER_VERSION } from './_niches.js';

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

// A scene asking for rendered words, a URL or a brand mark is either a bad
// generation or profile text steering the image model (profile fields are free
// text, and a scraped URL can carry anything). The hero prompt's negatives
// aren't a guarantee, so a suspect scene is dropped: no photo beats a photo
// with someone else's billboard in it, especially on the autopilot path where
// the image posts to a real account unreviewed.
const SCENE_BANNED = /\b(ignore|instruction|prompt|disregard|override|http|www|\.com|text|word|letter|caption|sign|billboard|poster|banner|label|logo|brand|watermark|screenshot|ui|interface)\b/i;

// The scene is model-written and lands verbatim inside an image prompt, so it
// is also scrubbed to plain prose — no newlines, quotes or braces to break out
// with.
export function cleanScene(scene) {
  const s = String(scene || '')
    .replace(/[^\w\s',.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 180);
  if (SCENE_BANNED.test(s)) return '';
  return s;
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

// The hook slide gets a real PHOTOGRAPH of what the hook is about — a hand
// dropping a phone in a drawer, not a decorative squiggle. One cinematic recipe
// for every style: the photo is always dark, so the canvas lays a top-down scrim
// and white type over it (see slide-render.mjs, opts.hero).
//
// Returns '' when there is no scene (legacy carousels predating hero_scene).
// The caller then skips the hero image entirely and slide 0 falls back to the
// abstract background — degraded, never broken.
export function heroPrompt(scene, profile, accentOverride) {
  const subject = cleanScene(scene);
  if (!subject) return '';
  const accent = validHex(accentOverride) || validHex(profile?.color);
  const accentLine = accent
    ? `\nOne natural object in the scene carries the color ${accent}. Nothing else is that color.`
    : '';
  return `Cinematic editorial photograph, portrait 4:5: ${subject}.
Photorealistic, shot on a 50mm lens: one clear subject, shallow depth of field, natural directional light, muted filmic color grade, dark understated surroundings. Documentary and candid, never staged stock photography, no eye contact with the camera.
Compose the subject in the lower two thirds of the frame. The top third stays dark, simple and uncluttered.${accentLine}
No illustration, no 3D render, no collage, no split screen. ABSOLUTELY NO text, letters, numbers, words, logos, watermarks, phone screens or user interfaces.`;
}

// 75% value listicles, 25% direct product showcase, deterministic by post count.
export function postKind(n) {
  return n % 4 === 3 ? 'showcase' : 'value';
}

// Tone is picked per generation, not pinned on the profile. Autopilot ships 30
// posts a month from one account: a single locked voice reads like a bot, and
// nobody ever went back to change a select they set once.
export const TONES = ['casual', 'professional', 'funny', 'authority'];

export function pickTone() {
  return TONES[Math.floor(Math.random() * TONES.length)];
}

export function retryablePlanError(error) {
  const message = String(error?.message || error || '');
  return /invalid response|empty response|AI error \((429|5\d\d)\)/i.test(message);
}

async function generatePlanJson(payload) {
  const input = JSON.stringify(payload);
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const retryInstruction = attempt
        ? '\n\nYour previous response was not valid JSON. Return one complete JSON object, double-check every comma, quote, brace, and bracket before responding.'
        : '';
      const out = await callGemini(CAROUSEL_COPY_PROMPT + retryInstruction, input, attempt ? 0.35 : 0.7);
      if (!out || !Array.isArray(out.slides) || out.slides.length === 0) {
        throw new Error('AI returned an invalid response. Please try again.');
      }
      return out;
    } catch (error) {
      lastError = error;
      if (attempt > 0 || !retryablePlanError(error)) throw error;
      console.warn('carousel plan generation failed once; retrying:', error.message);
    }
  }
  throw lastError;
}

// The closing ask, written by the model and painted on the last slide. A slide
// is an image, so a URL in it is unclickable noise — and profile text is free
// text a scrape could have steered. Strip URLs, keep it to one short line.
export function cleanCta(v) {
  const s = String(v || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (/https?:\/\/|www\.|\.[a-z]{2,}(\/|\b)/i.test(s)) return '';
  return s.substring(0, 60);
}

// Daily posting slots at 15:00 UTC (peak US morning/noon). Returns up to
// `days` future Date slots, skipping days that already have a post queued —
// backfills past collisions so the queue always reaches its target depth.
export function nextSlots(nowIso, existing, days) {
  const now = new Date(nowIso);
  const takenDays = new Set(existing.map((d) => new Date(d).toISOString().substring(0, 10)));
  const out = [];
  for (let i = 0; out.length < days && i < days + 7; i++) {
    const slot = new Date(now);
    slot.setUTCDate(slot.getUTCDate() + i);
    slot.setUTCHours(20, 0, 0, 0); // 5:30 AM ACST — due before the 20:30 UTC cron posts at 6 AM Adelaide
    if (slot <= now) continue;
    if (takenDays.has(slot.toISOString().substring(0, 10))) continue;
    out.push(slot);
  }
  return out;
}

export function buildPlanPayload({ profile, hook, kind, slideCount, tone }) {
  return {
    product: {
      name: profile.name || '',
      what: profile.what,
      who: profile.who || '',
      benefit: profile.benefit || '',
      facts: Array.isArray(profile.facts) ? profile.facts : [],
      url: profile.app_url || '',
      tone: TONES.includes(tone) ? tone : 'casual',
    },
    audienceNiche: profile.audience_niche?.name || 'General',
    hook: { template: hook.hook_template, verbatim: hook.hook_verbatim || '', topic: hook.topic || '' },
    kind: kind === 'showcase' ? 'showcase' : 'value',
    slideCount,
  };
}

// ============================================
// BEST-FIT HOOK SELECTION
// ============================================
// Two apps in the same niche must not draw from an identical random pool: the
// model ranks candidates for THIS app, then we random-pick among its picks —
// fit without repetition. Pure payload/validation helpers are unit tested.
export function buildHookPickPayload(profile, pool) {
  return {
    product: {
      name: profile.name || '',
      what: profile.what || '',
      who: profile.who || '',
      benefit: profile.benefit || '',
    },
    audienceNiche: profile.audience_niche?.name || 'General',
    hooks: pool.map((h) => ({
      id: h.id,
      hook: h.hook_verbatim || h.hook_template || '',
      topic: h.topic || '',
      views: Number(h.views || 0),
    })),
  };
}

export function resolveHookPick(pool, out) {
  const ids = Array.isArray(out?.ids) ? out.ids : [];
  const byId = new Map(pool.map((h) => [h.id, h]));
  const seen = new Set();
  const picked = [];
  for (const id of ids) {
    if (byId.has(id) && !seen.has(id)) {
      seen.add(id);
      picked.push(byId.get(id));
    }
  }
  return picked;
}

// Drop hooks the user's recent carousels already used — variety guard for
// small pools. Never empties the pool: with everything recently used, reuse
// beats a dead generate button.
export function excludeHooks(pool, usedIds) {
  const used = new Set(Array.isArray(usedIds) ? usedIds : []);
  const filtered = pool.filter((h) => !used.has(h.id));
  return filtered.length > 0 ? filtered : pool;
}

async function pickHook(profile, hookId, excludeHookIds) {
  const nicheSlug = profile.audience_niche?.slug || '';
  if (
    !nicheSlug ||
    Number(profile.audience_niche?.classifier_version) !== NICHE_CLASSIFIER_VERSION
  ) {
    return null;
  }
  if (Number.isInteger(hookId) && hookId > 0) {
    const found = (await getHooksByIds([hookId], nicheSlug))[0];
    if (found) return found;
  }
  // A brand-new audience niche starts empty (its mine runs async). Rather than
  // dead-ending the user's very first post, fall back to the strongest proven
  // hooks across ALL niches — the mechanism is what transfers, and the fit
  // screen below still judges every candidate against this product.
  let pool = excludeHooks(await getAutoHookPool(nicheSlug, 20), excludeHookIds);
  if (pool.length === 0) {
    pool = excludeHooks(await getGlobalHookPool(20), excludeHookIds);
  }
  if (pool.length === 0) return null;
  // Screen even a one-hook pool. An empty verdict, malformed response, or
  // upstream failure stops generation; a random bad-fit hook is not a useful
  // fallback for a customer-facing post.
  try {
    const out = await callGemini(HOOK_PICK_PROMPT, JSON.stringify(buildHookPickPayload(profile, pool)), 0.2);
    if (!out || !Array.isArray(out.ids)) return null;
    const fit = resolveHookPick(pool, out);
    if (fit.length > 0) return fit[Math.floor(Math.random() * fit.length)];
  } catch (e) {
    console.error('hook pick failed closed:', e.message);
  }
  return null;
}

export async function generateCarouselPlan({ profile, kind = 'value', hookId = null, styleOverride = '', excludeHookIds = null }) {
  const hook = await pickHook(profile, hookId, excludeHookIds);
  if (!hook) {
    throw new Error('No hooks passed the source-and-fit checks for this product yet — try again after the next research run.');
  }

  const styleKeys = Object.keys(STYLES);
  const style = STYLES[styleOverride] ? styleOverride : styleKeys[Math.floor(Math.random() * styleKeys.length)];

  const tone = pickTone();
  const payload = buildPlanPayload({ profile, hook, kind, slideCount: SLIDE_COUNT, tone });
  const out = await generatePlanJson(payload);

  const slides = out.slides.slice(0, SLIDE_COUNT).map((s, i) => ({
    index: i,
    heading: String(s.heading || '').substring(0, 120),
    body: String(s.body || '').substring(0, 220),
  }));

  // The ask rides on the last slide object, so it persists inside the existing
  // slides JSON — no column, no migration, and a carousel made before this
  // shipped simply renders without one.
  const cta = cleanCta(out.cta);
  if (cta) slides[slides.length - 1].cta = cta;
  const hashtags = (Array.isArray(out.hashtags) ? out.hashtags : [])
    .map((h) => String(h).replace(/^#/, '').replace(/[^a-z0-9_]/gi, '').toLowerCase())
    .filter(Boolean).slice(0, 8);
  let caption = String(out.caption || '').substring(0, 1000);
  if (hashtags.length > 0) caption = caption + '\n\n' + hashtags.map((h) => '#' + h).join(' ');

  return {
    hook, style, slides, caption,
    motifs: cleanMotifs(out.motifs),
    heroScene: cleanScene(out.heroScene),
    accent: validHex(profile.color),
  };
}
