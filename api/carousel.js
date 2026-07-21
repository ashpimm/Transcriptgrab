// api/carousel.js — Faceless carousel generation.
//
// POST /api/carousel {action:'plan', hookId, style}          -> slide copy plan + caption + hashtags
//                                                               (consumes: pro quota | credit | the one free)
// POST /api/carousel {action:'background', carouselId}       -> the textless bg the text slides sit on
// POST /api/carousel {action:'hero', carouselId}             -> the hook slide's photograph (may be null)
// POST /api/carousel {action:'slide', carouselId, index}     -> ONE rendered slide as data URL (legacy)
// GET  /api/carousel                                         -> { carousels } (history, copy only)
//
// The two images are fetched SEPARATELY and cached separately. They used to
// share one request, which meant a failed hero could null a good background,
// a hero that failed once was never retried, and both PNGs rode in one JSON
// body — near Vercel's response cap once the hero is a photograph.

import {
  getSession, getProfile, saveCarousel, getCarousels, getCarousel,
  saveCarouselBg, saveCarouselHero, canGenerateCarousel, consumeCarousel,
  getRecentHookIds, ensureReelSchema, getCarouselByIdForRender,
  claimReelRender, saveReelSubmission, saveReelState, getReelState,
} from './_db.js';
import { callGeminiImageRetry } from './_shared.js';
import {
  generateCarouselPlan, backgroundPrompt, heroPrompt, cleanMotifs, STYLES, resolveAccent,
} from './_generate.js';
import { renderReelSlideJpeg } from './_render.js';
import { publicBaseUrl, reelAssetUrl, verifyReelAsset } from './_reel.js';
import { getReelRender, shotstackEnabled, submitReel } from './_shotstack.js';

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

function reelJson(row) {
  if (!row) return { status: 'idle' };
  let status = row.reel_status || 'idle';
  const expiresAt = row.reel_url_expires_at;
  if (status === 'ready' && expiresAt && new Date(expiresAt).getTime() <= Date.now()) status = 'expired';
  return {
    status,
    url: status === 'ready' ? (row.reel_url || '') : '',
    error: row.reel_error || '',
    requestedAt: row.reel_requested_at || null,
    finishedAt: row.reel_finished_at || null,
    expiresAt: expiresAt || null,
  };
}

function reelJobIsFresh(row) {
  const requested = row?.reel_requested_at ? new Date(row.reel_requested_at).getTime() : 0;
  return requested > Date.now() - (30 * 60 * 1000);
}

async function serveReelSlide(req, res) {
  const carouselId = parseInt(req.query.carouselId, 10);
  const index = parseInt(req.query.index, 10);
  const expires = parseInt(req.query.expires, 10);
  const signature = String(req.query.signature || '');
  if (!verifyReelAsset({ carouselId, index, expires, signature })) {
    return res.status(403).json({ error: 'Invalid or expired Reel asset link.' });
  }
  const carousel = await getCarouselByIdForRender(carouselId);
  if (!carousel) return res.status(404).json({ error: 'Carousel not found.' });
  const jpeg = await renderReelSlideJpeg({ carousel, index, accent: carousel.profile?.color || '' });
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Content-Length', String(jpeg.length));
  res.setHeader('Cache-Control', 'public, max-age=3600, immutable');
  return res.status(200).send(jpeg);
}

export default async function handler(req, res) {
  if (cors(req, res)) return;

  try {
    if (req.method === 'GET' && req.query?.asset === 'reel-slide') {
      return await serveReelSlide(req, res);
    }

    const user = await getSession(req).catch(() => null);
    if (!user) return res.status(401).json({ error: 'Sign in required.' });

    if (req.method === 'GET') {
      await ensureReelSchema();
      const carousels = await getCarousels(user.id);
      return res.status(200).json({ carousels, reelEnabled: shotstackEnabled() });
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

      // hookId + style are optional — the done-for-you default picks a
      // best-fit hook from the audience niche's top performers + a random
      // style, avoiding hooks this user's recent carousels already used.
      const recentHookIds = await getRecentHookIds(user.id).catch(() => []);
      let plan;
      try {
        plan = await generateCarouselPlan({
          profile,
          hookId: parseInt(body.hookId, 10),
          styleOverride: body.style || '',
          kind: 'value',
          excludeHookIds: recentHookIds,
        });
      } catch (e) {
        if (String(e.message).startsWith('No hooks')) {
          return res.status(503).json({ error: e.message });
        }
        throw e;
      }

      const saved = await saveCarousel(
        user.id, plan.hook.id, plan.style, plan.slides, plan.caption, gate.watermark, plan.heroScene,
      );
      await consumeCarousel(user, gate.source);

      return res.status(200).json({
        carouselId: saved.id, style: plan.style, slides: plan.slides, caption: plan.caption,
        motifs: plan.motifs, accent: plan.accent,
        watermark: !!gate.watermark, source: gate.source, reelEnabled: shotstackEnabled(),
      });
    }

    // ===== REEL: submit/poll a silent 9:16 MP4 render for download =====
    if (action === 'reel') {
      if (!shotstackEnabled()) {
        return res.status(503).json({ error: 'Reel downloads are not configured yet.' });
      }
      await ensureReelSchema();
      const carouselId = parseInt(body.carouselId, 10);
      const carousel = await getCarousel(user.id, carouselId);
      if (!carousel) return res.status(404).json({ error: 'Carousel not found.' });
      if (!carousel.bg) {
        return res.status(409).json({ error: 'Finish generating the slide visuals before creating a Reel.' });
      }

      const before = await getReelState(user.id, carouselId);
      const existing = reelJson(before);
      if (['submitting', 'rendering'].includes(existing.status) && reelJobIsFresh(before)) {
        return res.status(202).json(existing);
      }
      if (existing.status === 'ready') return res.status(200).json(existing);

      const claimed = await claimReelRender(user.id, carouselId);
      if (!claimed) return res.status(202).json(reelJson(await getReelState(user.id, carouselId)));
      try {
        const expires = Math.floor(Date.now() / 1000) + (2 * 60 * 60);
        const baseUrl = publicBaseUrl(req);
        const assetUrls = [...carousel.slides]
          .sort((a, b) => a.index - b.index)
          .map((slide) => reelAssetUrl({ baseUrl, carouselId, index: slide.index, expires }));
        const submitted = await submitReel(assetUrls);
        await saveReelSubmission(user.id, carouselId, submitted.id);
        return res.status(202).json(reelJson(await getReelState(user.id, carouselId)));
      } catch (error) {
        await saveReelState(user.id, carouselId, { status: 'failed', error: String(error.message || error).substring(0, 500) });
        return res.status(502).json({ status: 'failed', error: 'The Reel renderer could not start. Please try again.' });
      }
    }

    if (action === 'reel-status') {
      await ensureReelSchema();
      const carouselId = parseInt(body.carouselId, 10);
      const state = await getReelState(user.id, carouselId);
      if (!state) return res.status(404).json({ error: 'Carousel not found.' });
      const current = reelJson(state);
      if (current.status === 'ready' || current.status === 'failed' || current.status === 'expired' || current.status === 'idle') {
        if (current.status === 'expired' && state.reel_status !== 'expired') {
          await saveReelState(user.id, carouselId, { status: 'expired', error: '' });
        }
        return res.status(200).json(current);
      }
      if (!state.reel_render_id) {
        if (!reelJobIsFresh(state)) {
          await saveReelState(user.id, carouselId, { status: 'failed', error: 'The Reel render did not start. Please retry.' });
          return res.status(200).json(reelJson(await getReelState(user.id, carouselId)));
        }
        return res.status(202).json(current);
      }
      try {
        const provider = await getReelRender(state.reel_render_id);
        await saveReelState(user.id, carouselId, provider.state === 'ready'
          ? { status: 'ready', url: provider.url, poster: provider.poster || '', error: '' }
          : provider.state === 'failed'
            ? { status: 'failed', error: provider.error || 'Video render failed.' }
            : { status: 'rendering', error: '' });
        return res.status(200).json(reelJson(await getReelState(user.id, carouselId)));
      } catch (error) {
        console.error('reel status check delayed:', error.message);
        return res.status(202).json(current);
      }
    }

    // ===== BACKGROUND: the textless art every TEXT slide sits on =====
    if (action === 'background') {
      const carousel = await getCarousel(user.id, parseInt(body.carouselId, 10));
      if (!carousel) return res.status(404).json({ error: 'Carousel not found.' });

      // Cached on the carousel — revisiting history is free. Only body.fresh
      // (the "New visuals" button) buys a new one.
      if (carousel.bg && !body.fresh) {
        return res.status(200).json({
          image: `data:image/png;base64,${carousel.bg}`,
          style: carousel.style,
          watermark: !!carousel.watermark,
        });
      }

      const profile = await getProfile(user.id).catch(() => null);
      const b64 = await callGeminiImageRetry(
        backgroundPrompt(carousel.style, profile, cleanMotifs(body.motifs), body.accent),
      );
      await saveCarouselBg(user.id, carousel.id, b64)
        .catch((e) => console.error('bg cache failed:', e.message));

      return res.status(200).json({
        image: `data:image/png;base64,${b64}`,
        style: carousel.style,
        watermark: !!carousel.watermark,
      });
    }

    // ===== HERO: the hook slide's photograph. Best-effort by design — a null
    // hero means slide 0 falls back to the background, which is what every
    // carousel looked like before this existed. Never a 500. =====
    if (action === 'hero') {
      const carousel = await getCarousel(user.id, parseInt(body.carouselId, 10));
      if (!carousel) return res.status(404).json({ error: 'Carousel not found.' });

      if (carousel.hero && !body.fresh) {
        return res.status(200).json({ hero: `data:image/png;base64,${carousel.hero}` });
      }

      // The scene is read from the row, NEVER from the client — it lands inside
      // an image prompt. Carousels made before this shipped have no scene, and
      // heroPrompt returns '' for them: no call, no spend, no cover photo.
      const profile = await getProfile(user.id).catch(() => null);
      const prompt = heroPrompt(carousel.hero_scene, profile, body.accent);
      if (!prompt) return res.status(200).json({ hero: null, reason: 'no_scene' });

      let b64;
      try {
        b64 = await callGeminiImageRetry(prompt);
      } catch (e) {
        console.error('hero image failed:', e.message);
        return res.status(200).json({ hero: null, reason: 'failed' });
      }
      await saveCarouselHero(user.id, carousel.id, b64)
        .catch((e) => console.error('hero cache failed:', e.message));

      return res.status(200).json({ hero: `data:image/png;base64,${b64}` });
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
      const b64 = await callGeminiImageRetry(slidePrompt(carousel.style, slide, slides.length, legacyProfile));
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
