// api/carousel.js — Faceless carousel generation.
//
// POST /api/carousel {action:'plan', hookId, style}       -> slide copy plan + caption + hashtags
//                                                            (consumes: pro quota | credit | the one free)
// POST /api/carousel {action:'slide', carouselId, index}  -> ONE rendered slide as data URL
// GET  /api/carousel                                      -> { carousels } (history, copy only)

import {
  getSession, getHooksByIds, getProfile, getAutoHookPool,
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

    // ===== PLAN: hook -> slide copy + caption + hashtags =====
    if (action === 'plan') {
      const gate = canGenerateCarousel(user);
      if (!gate.allowed) {
        const msg = gate.reason === 'monthly_limit'
          ? 'You have used all 20 carousels this month. They reset on your billing date. Need more now? Grab a credit pack.'
          : 'You have used your free carousel. Go Pro for 20 a month, or grab a $5 credit pack.';
        return res.status(402).json({ error: msg, reason: gate.reason, upgrade: gate.reason === 'upgrade' });
      }

      const profile = await getProfile(user.id);
      if (!profile || !profile.what) {
        return res.status(400).json({ error: 'Set up your app profile first.', needsProfile: true });
      }

      // hookId is optional — the done-for-you default picks a random hook
      // from the niche's top performers (curated patterns + best receipts).
      let hook = null;
      const hookId = parseInt(body.hookId, 10);
      if (Number.isInteger(hookId) && hookId > 0) {
        hook = (await getHooksByIds([hookId]))[0] || null;
      }
      if (!hook) {
        const pool = await getAutoHookPool('appdev', 10);
        if (pool.length === 0) return res.status(503).json({ error: 'No hooks available yet — try again shortly.' });
        hook = pool[Math.floor(Math.random() * pool.length)];
      }

      // style optional too — no pick means we choose for you
      const styleKeys = Object.keys(STYLES);
      const style = STYLES[body.style] ? body.style : styleKeys[Math.floor(Math.random() * styleKeys.length)];
      const payload = {
        app: {
          name: profile.name || '',
          what: profile.what,
          who: profile.who || '',
          benefit: profile.benefit || '',
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
      const hashtags = (Array.isArray(out.hashtags) ? out.hashtags : [])
        .map((h) => String(h).replace(/^#/, '').replace(/[^a-z0-9_]/gi, '').toLowerCase())
        .filter(Boolean)
        .slice(0, 8);
      let caption = String(out.caption || '').substring(0, 1000);
      if (hashtags.length > 0) {
        caption = caption + '\n\n' + hashtags.map((h) => '#' + h).join(' ');
      }

      const saved = await saveCarousel(user.id, hook.id, style, slides, caption, gate.watermark);
      await consumeCarousel(user, gate.source);

      return res.status(200).json({
        carouselId: saved.id, style, slides, caption,
        watermark: !!gate.watermark, source: gate.source,
      });
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
      // Free-tier watermark is drawn client-side on the last slide (canvas
      // overlay) — image models can't render small text reliably.
      const isLast = idx === slides.length - 1;
      return res.status(200).json({
        index: idx,
        image: `data:image/png;base64,${b64}`,
        watermark: !!carousel.watermark && isLast,
      });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    console.error('carousel error:', e);
    const msg = e.message && (e.message.startsWith('AI') || e.message.startsWith('Image'))
      ? e.message : 'Something went wrong. Please try again.';
    return res.status(500).json({ error: msg });
  }
}
