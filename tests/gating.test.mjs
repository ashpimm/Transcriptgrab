import test from 'node:test';
import assert from 'node:assert';
import { canGenerateCarousel, FREE_CAROUSELS, CAROUSELS_PER_MONTH } from '../api/_db.js';

test('constants', () => {
  assert.equal(FREE_CAROUSELS, 3);
  assert.equal(CAROUSELS_PER_MONTH, 30);
});

test('free user gets 3 watermarked carousels', () => {
  for (const used of [0, 1, 2]) {
    const g = canGenerateCarousel({ tier: 'free', free_carousels_used: used, credits: 0 });
    assert.deepEqual(g, { allowed: true, source: 'free', watermark: true });
  }
});

test('free user blocked at 3', () => {
  const g = canGenerateCarousel({ tier: 'free', free_carousels_used: 3, credits: 0 });
  assert.equal(g.allowed, false);
  assert.equal(g.reason, 'upgrade');
});

test('legacy boolean-only user (migrated to 1) still has 2 left', () => {
  const g = canGenerateCarousel({ tier: 'free', free_carousels_used: 1, credits: 0 });
  assert.equal(g.allowed, true);
});

test('pro (autopilot) 30/mo, no watermark', () => {
  assert.deepEqual(
    canGenerateCarousel({ tier: 'pro', carousels_used: 29, credits: 0 }),
    { allowed: true, source: 'pro', watermark: false }
  );
  assert.equal(canGenerateCarousel({ tier: 'pro', carousels_used: 30, credits: 0 }).allowed, false);
});

test('credits consumed after pro quota, before free', () => {
  const g = canGenerateCarousel({ tier: 'free', free_carousels_used: 0, credits: 2 });
  assert.deepEqual(g, { allowed: true, source: 'credit', watermark: false });
});

test('null user blocked', () => {
  assert.equal(canGenerateCarousel(null).allowed, false);
});
