import test from 'node:test';
import assert from 'node:assert';
import { renderSlidePngs } from '../api/_render.js';

// 1x1 red PNG
const PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('renders one PNG buffer per slide', async () => {
  const bufs = await renderSlidePngs({
    slides: [
      { index: 0, heading: '5 things I wish I knew before losing weight', body: '' },
      { index: 1, heading: 'Eat protein first', body: 'It keeps you full and protects muscle while you cut.' },
    ],
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
