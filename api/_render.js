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
  for (const slide of slides) {
    const canvas = createCanvas(SLIDE_W, SLIDE_H);
    const isLast = slide.index === slides.length - 1;
    const isHero = !!hero && slide.index === 0;
    drawSlideOn(canvas, isHero ? hero : bg, slide, slides.length, style, accent, {
      hero: isHero,
      watermark: !!watermark && isLast,
      fontSans: 'Geist',
      fontMono: '"Geist Mono"',
    });
    out.push(canvas.toBuffer('image/png'));
  }
  return out;
}
