// api/_render.js — Server-side slide rendering for autopilot posting.
// Uses the SAME drawSlideOn as the browser (slide-render.mjs) so posted
// slides are pixel-identical to the create-page preview.
// Vercel ignores _-prefixed files in api/ as endpoints.

import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { drawSlideOn, SLIDE_W, SLIDE_H } from '../slide-render.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fonts');
let fontsReady = false;

function registerFonts() {
  if (fontsReady) return;
  for (const f of ['Geist-Medium.ttf', 'Geist-ExtraBold.ttf', 'GeistMono-Medium.ttf']) {
    const p = join(FONT_DIR, f);
    if (existsSync(p)) GlobalFonts.registerFromPath(p, f.startsWith('GeistMono') ? 'Geist Mono' : 'Geist');
  }
  fontsReady = true;
}

export async function renderSlidePngs({ slides, style, accent, bgBase64, heroBase64, watermark }) {
  registerFonts();
  const bg = await loadImage(Buffer.from(bgBase64, 'base64'));
  // Slide 0 rides a real photograph when we have one. A hero that fails to
  // decode falls back to the background — a post still goes out.
  const hero = heroBase64
    ? await loadImage(Buffer.from(heroBase64, 'base64')).catch(() => null)
    : null;

  const out = [];
  for (const slide of slides) out.push(renderLoadedSlide({
    slide, slides, style, accent, bg, hero, watermark, width: SLIDE_W, height: SLIDE_H,
  }));
  return out;
}

function renderLoadedSlide({ slide, slides, style, accent, bg, hero, watermark, width, height, format = 'png' }) {
  const canvas = createCanvas(width, height);
  const isLast = slide.index === slides.length - 1;
  const isHero = !!hero && slide.index === 0;
  drawSlideOn(canvas, isHero ? hero : bg, slide, slides.length, style, accent, {
    hero: isHero,
    watermark: !!watermark && isLast,
    fontSans: 'Geist',
    fontMono: '"Geist Mono"',
  });
  // Reel frames cross a public serverless response before the video provider
  // fetches them. JPEG keeps photo-heavy frames comfortably below Vercel's
  // response limit; carousel downloads stay lossless PNGs.
  return format === 'jpeg'
    ? canvas.toBuffer('image/jpeg', 92)
    : canvas.toBuffer('image/png');
}

export async function renderReelSlideJpeg({ carousel, index, accent }) {
  registerFonts();
  const slides = Array.isArray(carousel.slides) ? carousel.slides : [];
  const slide = slides.find((item) => item.index === index);
  if (!slide || !carousel.bg) throw new Error('Reel slide assets are not ready.');
  const [bg, hero] = await Promise.all([
    loadImage(Buffer.from(carousel.bg, 'base64')),
    carousel.hero
      ? loadImage(Buffer.from(carousel.hero, 'base64')).catch(() => null)
      : Promise.resolve(null),
  ]);
  return renderLoadedSlide({
    slide, slides, style: carousel.style, accent, bg, hero,
    watermark: !!carousel.watermark, width: 1080, height: 1920, format: 'jpeg',
  });
}
