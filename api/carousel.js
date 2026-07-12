// api/carousel.js — Faceless carousel generation.
//
// POST /api/carousel {action:'plan', hookId, style}       -> slide copy plan + caption + hashtags
//                                                            (consumes: pro quota | credit | the one free)
// POST /api/carousel {action:'slide', carouselId, index}  -> ONE rendered slide as data URL
// GET  /api/carousel                                      -> { carousels } (history, copy only)

import {
  getSession, getProfile, saveCarousel, getCarousels, getCarousel,
  canGenerateCarousel, consumeCarousel,
} from './_db.js';
import { callGeminiImage } from './_shared.js';
import { generateCarouselPlan, backgroundPrompt, cleanMotifs, STYLES, resolveAccent } from './_generate.js';

export const maxDuration = 60;

function slidePrompt(style, slide, slideCount, profile) {
  const base = (STYLES[style] || STYLES.bold).split('ACCENT').join(resolveAccent(style, profile));
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
          ? 'You have used all 30 posts this month. They reset on your billing date.'
          : 'You have used your 3 free carousels. Autopilot is $19/mo — content posted daily for you.';
        return res.status(402).json({ error: msg, reason: gate.reason, upgrade: gate.reason === 'upgrade' });
      }

      const profile = await getProfile(user.id);
      if (!profile || !profile.what) {
        return res.status(400).json({ error: 'Set up your app profile first.', needsProfile: true });
      }

      // hookId + style are optional — the done-for-you default picks a random
      // hook from the audience niche's top performers + a random style.
      let plan;
      try {
        plan = await generateCarouselPlan({
          profile,
          hookId: parseInt(body.hookId, 10),
          styleOverride: body.style || '',
          kind: 'value',
        });
      } catch (e) {
        if (String(e.message).startsWith('No hooks')) {
          return res.status(503).json({ error: e.message });
        }
        throw e;
      }

      const saved = await saveCarousel(user.id, plan.hook.id, plan.style, plan.slides, plan.caption, gate.watermark);
      await consumeCarousel(user, gate.source);

      return res.status(200).json({
        carouselId: saved.id, style: plan.style, slides: plan.slides, caption: plan.caption,
        motifs: plan.motifs, accent: plan.accent,
        watermark: !!gate.watermark, source: gate.source,
      });
    }

    // ===== BACKGROUND: one textless image per carousel; client draws the text =====
    if (action === 'background') {
      const carousel = await getCarousel(user.id, parseInt(body.carouselId, 10));
      if (!carousel) return res.status(404).json({ error: 'Carousel not found.' });
      const profile = await getProfile(user.id).catch(() => null);

      const prompt = backgroundPrompt(carousel.style, profile, cleanMotifs(body.motifs), body.accent);
      let b64;
      try {
        b64 = await callGeminiImage(prompt);
      } catch (e) {
        // one automatic retry — image gen fails transiently
        b64 = await callGeminiImage(prompt);
      }
      return res.status(200).json({
        image: `data:image/png;base64,${b64}`,
        style: carousel.style,
        watermark: !!carousel.watermark,
      });
    }

    // ===== SLIDE: render one image (legacy path for cached clients) =====
    if (action === 'slide') {
      const carousel = await getCarousel(user.id, parseInt(body.carouselId, 10));
      if (!carousel) return res.status(404).json({ error: 'Carousel not found.' });
      const slides = carousel.slides;
      const idx = parseInt(body.index, 10);
      const slide = Array.isArray(slides) ? slides.find((s) => s.index === idx) : null;
      if (!slide) return res.status(400).json({ error: 'Slide not found.' });

      const legacyProfile = await getProfile(user.id).catch(() => null);
      const prompt = slidePrompt(carousel.style, slide, slides.length, legacyProfile);
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
