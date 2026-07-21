import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import {
  canGenerateCarousel, FREE_CAROUSELS, CAROUSELS_PER_MONTH, monthlyUsageNeedsReset,
} from '../api/_db.js';

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

test('monthly usage resets legacy missing dates and expired dates', () => {
  const now = new Date('2026-07-21T08:00:00Z');
  assert.equal(monthlyUsageNeedsReset({ usage_reset_at: null }, now), true);
  assert.equal(monthlyUsageNeedsReset({ usage_reset_at: '2026-07-01T00:00:00Z' }, now), true);
  assert.equal(monthlyUsageNeedsReset({ usage_reset_at: '2026-08-01T00:00:00Z' }, now), false);
});

test('starting or restarting Pro clears stale carousel usage', () => {
  const source = fs.readFileSync(new URL('../api/_db.js', import.meta.url), 'utf8');
  const setPro = source.match(/export async function setProStatus[\s\S]*?\n}/)?.[0] || '';
  assert.match(setPro, /carousels_used = 0/);
});
