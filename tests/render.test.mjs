import test from 'node:test';
import assert from 'node:assert';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { renderSlidePngs } from '../api/_render.js';
import { SLIDE_W, SLIDE_H } from '../slide-render.mjs';

// 1x1 red PNG
const PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const SLIDES = [
  { index: 0, heading: '5 things I wish I knew before losing weight', body: '' },
  { index: 1, heading: 'Eat protein first', body: 'It keeps you full and protects muscle while you cut.' },
];

test('renders one PNG buffer per slide', async () => {
  const bufs = await renderSlidePngs({
    slides: SLIDES,
    style: 'bold',
    accent: '#22C55E',
    bgBase64: PX,
    watermark: true,
  });
  assert.equal(bufs.length, 2);
  for (const b of bufs) {
    assert.ok(Buffer.isBuffer(b));
    assert.equal(b.subarray(1, 4).toString('ascii'), 'PNG');
    assert.ok(b.length > 5000); // real 1080x1350 render, not an empty canvas
  }
});

// 1x1 blue PNG — a stand-in "photograph", so slide 0 differs from the rest.
const BLUE = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('the hero image is used for slide 0 only', async () => {
  const withHero = await renderSlidePngs({
    slides: SLIDES, style: 'bold', accent: '#22C55E',
    bgBase64: PX, heroBase64: BLUE, watermark: false,
  });
  const without = await renderSlidePngs({
    slides: SLIDES, style: 'bold', accent: '#22C55E',
    bgBase64: PX, watermark: false,
  });
  assert.equal(withHero.length, 2);
  // slide 0 changes (different image + scrim + top-anchored type)
  assert.ok(!withHero[0].equals(without[0]));
  // slide 1 is byte-identical — the hero must not touch the text slides
  assert.ok(withHero[1].equals(without[1]));
});

// The scrim used to be a fixed gradient sized for a short hook. A long heading
// ran straight past it into bare photo — white type on a bright frame.
test('a long hook heading stays inside the hero scrim', async () => {
  // a white 1x1: the worst possible photo to put white type on
  const WHITE = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8//9/PQAJewN9lQzeUgAAAABJRU5ErkJggg==';
  const long = {
    index: 0,
    heading: 'I deleted every single app that was quietly eating my mornings and my focus',
    body: '',
  };
  const [png] = await renderSlidePngs({
    slides: [long], style: 'bold', accent: '#22C55E',
    bgBase64: WHITE, heroBase64: WHITE, watermark: false,
  });

  const img = await loadImage(png);
  const c = createCanvas(SLIDE_W, SLIDE_H);
  c.getContext('2d').drawImage(img, 0, 0);
  const px = c.getContext('2d').getImageData(0, 0, SLIDE_W, SLIDE_H).data;
  const lumAt = (x, y) => {
    const i = (y * SLIDE_W + x) * 4;
    return 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
  };

  // Find how far down the white glyphs actually reach (text is left-aligned
  // within x 100..980, so a near-white pixel there is type, not photo).
  let glyphBottom = 0;
  for (let y = 100; y < SLIDE_H; y++) {
    for (let x = 100; x < 980; x += 4) {
      if (lumAt(x, y) > 240) { glyphBottom = y; break; }
    }
  }
  assert.ok(glyphBottom > 400, 'expected a multi-line heading to test against');

  // Now sample the BACKDROP beside the type (x=1040 is past the text column) at
  // every row the type occupies. The photo underneath is pure white, so this is
  // measuring the scrim alone: it must stay dark the whole way down the block.
  let worst = 0;
  for (let y = 100; y <= glyphBottom; y += 5) worst = Math.max(worst, lumAt(1040, y));
  assert.ok(
    worst < 110,
    `heading reaches y=${glyphBottom}, where the scrim has faded to ${worst.toFixed(0)}/255 — white type would not read there`,
  );
});

// The CTA is the whole point of the post: the last slide asks for the install.
// It rides on the slide object (slides[last].cta) so it needs no DB column and
// old carousels simply render without it.
test('the CTA is drawn on the slide that carries it, and only there', async () => {
  const withCta = await renderSlidePngs({
    slides: [SLIDES[0], { ...SLIDES[1], cta: 'Get CalSnap. Link in bio.' }],
    style: 'bold', accent: '#22C55E', bgBase64: PX, watermark: false,
  });
  const without = await renderSlidePngs({
    slides: SLIDES, style: 'bold', accent: '#22C55E', bgBase64: PX, watermark: false,
  });
  assert.ok(!withCta[1].equals(without[1]), 'last slide should show the CTA');
  assert.ok(withCta[0].equals(without[0]), 'the CTA must not leak onto other slides');
});

test('a carousel with no CTA renders exactly as it did before', async () => {
  const [a] = await renderSlidePngs({
    slides: [{ index: 0, heading: 'Eat protein first', body: 'Keeps you full.', cta: '' }],
    style: 'bold', accent: '#22C55E', bgBase64: PX, watermark: false,
  });
  const [b] = await renderSlidePngs({
    slides: [{ index: 0, heading: 'Eat protein first', body: 'Keeps you full.' }],
    style: 'bold', accent: '#22C55E', bgBase64: PX, watermark: false,
  });
  assert.ok(a.equals(b));
});

// Free tier stamps the watermark in the bottom-right of the same last slide the
// CTA lands on. A long CTA must give way, not run under the mark.
test('a long CTA never collides with the free-tier watermark', async () => {
  const [png] = await renderSlidePngs({
    slides: [{
      index: 0,
      heading: 'Stop guessing your calories',
      body: 'One photo, full macros, no weighing scale.',
      cta: 'Start counting properly with CalSnap today, link in bio',
    }],
    style: 'bold', accent: '#22C55E', bgBase64: PX, watermark: true,
  });

  const img = await loadImage(png);
  const c = createCanvas(SLIDE_W, SLIDE_H);
  c.getContext('2d').drawImage(img, 0, 0);
  const px = c.getContext('2d').getImageData(0, 0, SLIDE_W, SLIDE_H).data;

  // The accent is a saturated green; the watermark is grey-white on charcoal.
  // No accent-green pixel may appear inside the watermark's corner box.
  const isAccent = (x, y) => {
    const i = (y * SLIDE_W + x) * 4;
    return px[i + 1] > 110 && px[i + 1] > px[i] + 40 && px[i + 1] > px[i + 2] + 40;
  };
  let hits = 0;
  for (let y = SLIDE_H - 110; y < SLIDE_H - 20; y++) {
    for (let x = SLIDE_W - 380; x < SLIDE_W; x++) if (isAccent(x, y)) hits++;
  }
  assert.equal(hits, 0, `${hits} accent pixels landed in the watermark's corner`);
});

// First live IG publish (2026-07-17) shipped the CTA in the app's near-black
// brand color on the bold theme's dark overlay: black on black. The hero had a
// contrast guard; the CTA and text-slide accent bar did not.
async function ctaPixels(accent, style) {
  const slide = { index: 0, heading: 'Snap it', body: '', cta: 'Get HUD Plus. Link in bio.' };
  const [withCta] = await renderSlidePngs({ slides: [slide], style, accent, bgBase64: PX, watermark: false });
  const [without] = await renderSlidePngs({ slides: [{ ...slide, cta: '' }], style, accent, bgBase64: PX, watermark: false });
  const load = async (png) => {
    const img = await loadImage(png);
    const c = createCanvas(SLIDE_W, SLIDE_H);
    c.getContext('2d').drawImage(img, 0, 0);
    return c.getContext('2d').getImageData(0, 0, SLIDE_W, SLIDE_H).data;
  };
  const a = await load(withCta), b = await load(without);
  // luminance of every pixel the CTA actually painted
  const lums = [];
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) {
      lums.push(0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2]);
    }
  }
  return lums;
}

test('a near-black brand color still gives a readable CTA on dark themes', async () => {
  const lums = await ctaPixels('#0A0A14', 'bold');
  assert.ok(lums.length > 200, 'expected the CTA to paint pixels');
  const bright = Math.max(...lums);
  assert.ok(bright > 140, `brightest CTA pixel is ${bright.toFixed(0)}/255 — unreadable on the dark overlay`);
});

test('a near-white brand color still gives a readable CTA on paper themes', async () => {
  const lums = await ctaPixels('#FAFAFA', 'mono');
  assert.ok(lums.length > 200, 'expected the CTA to paint pixels');
  const dark = Math.min(...lums);
  assert.ok(dark < 120, `darkest CTA pixel is ${dark.toFixed(0)}/255 — unreadable on the paper wash`);
});

test('an undecodable hero degrades to the background instead of throwing', async () => {
  const bufs = await renderSlidePngs({
    slides: SLIDES, style: 'bold', accent: '#22C55E',
    bgBase64: PX, heroBase64: 'not-a-png', watermark: false,
  });
  const baseline = await renderSlidePngs({
    slides: SLIDES, style: 'bold', accent: '#22C55E',
    bgBase64: PX, watermark: false,
  });
  assert.equal(bufs.length, 2);
  assert.ok(bufs[0].equals(baseline[0])); // slide 0 fell back to the bg render
});
