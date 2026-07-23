import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../api/_db.js', import.meta.url), 'utf8');

test('anon db functions exported', () => {
  for (const fn of [
    'ensureAnonSchema', 'reserveAnonSlot', 'attachAnonProfile', 'getAnonProfile',
    'completeAnonSlot', 'releaseAnonSlot', 'claimAnonForUser',
    'getCarouselAnon', 'getCarouselsAnon', 'saveCarouselBgAnon', 'saveCarouselHeroAnon',
  ]) {
    assert.match(src, new RegExp('export async function ' + fn + '\\b'), fn + ' missing');
  }
});

test('anon schema is lazy + nullable user_id', () => {
  assert.match(src, /CREATE TABLE IF NOT EXISTS anon_slots/);
  assert.match(src, /ADD COLUMN IF NOT EXISTS anon_id/);
  assert.match(src, /user_id DROP NOT NULL/);
});

test('reserve uses evaluateAnonThrottle', () => {
  const fn = src.match(/export async function reserveAnonSlot[\s\S]*?\n}/)?.[0] || '';
  assert.match(fn, /evaluateAnonThrottle/);
  assert.match(fn, /status = 'complete'/); // per-IP counts completed only
});

test('claim bumps free usage and clears anon_id', () => {
  const claim = src.match(/export async function claimAnonForUser[\s\S]*?\n}/)?.[0] || '';
  assert.match(claim, /free_carousels_used/);
  assert.match(claim, /anon_id = NULL/);
  assert.match(claim, /claimed_by IS NULL/);
});

test('authed saveCarousel INSERT does not reference anon_id', () => {
  // The authed branch must stay column-identical so it never touches a column
  // that may not exist before the migration runs. The authed INSERT lists
  // columns ending in hero_scene) then VALUES (${userId}; the anon INSERT is
  // the only one carrying anon_id, and it VALUES (NULL, ...).
  assert.match(src, /watermark, hero_scene\)\r?\n\s*VALUES \(\$\{userId\}/);
  assert.match(src, /watermark, hero_scene, anon_id\)\r?\n\s*VALUES \(NULL,/);
});
