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
