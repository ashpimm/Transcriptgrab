// api/carousel.js — Faceless carousel generation (Pro only).
//
// POST /api/carousel {action:'plan', hookId, style}       -> slide copy plan (counts 1 vs monthly cap)
// POST /api/carousel {action:'slide', carouselId, index}  -> ONE rendered slide as data URL
// GET  /api/carousel                                      -> { carousels } (history, copy only)

import {
  getSession, getHooksByIds, getProfile,
  saveCarousel, getCarousels, getCarousel,
  canGenerateCarousel, consumeCarousel,
} from './_db.js';
import { callGemini, callGeminiImage } from './_shared.js';
import { CAROUSEL_COPY_PROMPT } from './_prompts.js';

export const maxDuration = 60;

const SLIDE_COUNT = 6;

// Style descriptors keep slide-to-slide consistency: same descriptor + slide
// number is the whole prompt, so a set reads as one designed carousel.
const STYLES = {
  bold: 'Bold typographic social media slide: massive high-contrast sans-serif text on a deep charcoal (#101418) background with one safety-orange (#FF4D00) accent element per slide. Swiss poster energy. Flat, no photos, no gradients busier than two stops.',
  mono: 'Minimal black-and-white editorial slide: off-white (#FAFAF7) paper background, large tight black grotesque type, one thin underline accent. Lots of whitespace. No images, no color.',
  notebook: 'Hand-drawn notebook style slide: cream paper texture, handwritten-style marker lettering in dark ink, small doodle underlines and arrows, one red-orange circled highlight. Feels like smart lecture notes.',
  stat: 'Dark data-card slide: near-black background, big monospace-style numerals and labels, thin grid lines, one glowing orange stat highlight. Feels like a terminal dashboard turned into a poster.',
};

function slidePrompt(style, slide, slideCount) {
  const base = STYLES[style] || STYLES.bold;
  const body = slide.body ? ` Below it, smaller supporting text reading EXACTLY: "${slide.body}"` : '';
  return `${base}
Portrait 4:5 social media carousel slide, slide ${slide.index + 1} of ${slideCount}.
The slide's main text must read EXACTLY, with correct spelling: "${slide.heading}"${body}
Text must be large, perfectly legible, and the visual focus. No watermarks, no extra words beyond the given text, no borders.`;
}

function cors(req, res) {
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  const allowed = !origin || (function () { try { return new URL(origin).host === host; } catch { return false; } })();
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') { res.status(200).end(); return true; }
  return false;
}

export default async function handler(req, res) {
  if (cors(req, res)) return;

  try {
    const user = await getSession(req).catch(() => null);
    if (!user) return res.status(401).json({ error: 'Sign in required.' });

    if (req.method === 'GET') {
      const carousels = await getCarousels(user.id);
      return res.status(200).json({ carousels });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const action = body.action || '';

    // ===== PLAN: hook -> slide copy =====
    if (action === 'plan') {
      const gate = canGenerateCarousel(user);
      if (!gate.allowed) {
        const msg = gate.reason === 'monthly_limit'
          ? 'You have used all 30 carousels this month. They reset on your billing date.'
          : 'Faceless carousels are a Pro feature.';
        return res.status(402).json({ error: msg, reason: gate.reason, upgrade: gate.reason === 'upgrade' });
      }

      const profile = await getProfile(user.id);
      if (!profile || !profile.sells) {
        return res.status(400).json({ error: 'Set up your business profile first.', needsProfile: true });
      }

      const hooks = await getHooksByIds([parseInt(body.hookId, 10)]);
      if (hooks.length === 0) return res.status(400).json({ error: 'Pick a hook first.' });
      const hook = hooks[0];

      const style = STYLES[body.style] ? body.style : 'bold';
      const payload = {
        business: {
          sells: profile.sells,
          audience: profile.audience || '',
          results: profile.results || [],
          tone: profile.tone || 'casual',
        },
        hook: { template: hook.hook_template, verbatim: hook.hook_verbatim || '', topic: hook.topic || '' },
        slideCount: SLIDE_COUNT,
      };
      const out = await callGemini(CAROUSEL_COPY_PROMPT, JSON.stringify(payload), 0.7);
      if (!out || !Array.isArray(out.slides) || out.slides.length === 0) {
        throw new Error('AI returned an invalid response. Please try again.');
      }

      const slides = out.slides.slice(0, SLIDE_COUNT).map((s, i) => ({
        index: i,
        heading: String(s.heading || '').substring(0, 120),
        body: String(s.body || '').substring(0, 220),
      }));
      const caption = String(out.caption || '').substring(0, 1000);

      const saved = await saveCarousel(user.id, hook.id, style, slides, caption);
      await consumeCarousel(user);

      return res.status(200).json({ carouselId: saved.id, style, slides, caption });
    }

    // ===== SLIDE: render one image =====
    if (action === 'slide') {
      const carousel = await getCarousel(user.id, parseInt(body.carouselId, 10));
      if (!carousel) return res.status(404).json({ error: 'Carousel not found.' });
      const slides = carousel.slides;
      const idx = parseInt(body.index, 10);
      const slide = Array.isArray(slides) ? slides.find((s) => s.index === idx) : null;
      if (!slide) return res.status(400).json({ error: 'Slide not found.' });

      const prompt = slidePrompt(carousel.style, slide, slides.length);
      let b64;
      try {
        b64 = await callGeminiImage(prompt);
      } catch (e) {
        // one automatic retry — image gen fails transiently
        b64 = await callGeminiImage(prompt);
      }
      return res.status(200).json({ index: idx, image: `data:image/png;base64,${b64}` });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    console.error('carousel error:', e);
    const msg = e.message && (e.message.startsWith('AI') || e.message.startsWith('Image'))
      ? e.message : 'Something went wrong. Please try again.';
    return res.status(500).json({ error: msg });
  }
}
