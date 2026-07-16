import test from 'node:test';
import assert from 'node:assert';
import { slugifyNiche, mergeKeywords } from '../api/_db.js';

test('lowercase kebab', () => {
  assert.equal(slugifyNiche('Fitness & Weight Loss'), 'fitness-weight-loss');
});

test('collapses runs, trims edge dashes', () => {
  assert.equal(slugifyNiche('  Home -- Cooking!! '), 'home-cooking');
});

test('caps at 50 chars without trailing dash', () => {
  const s = slugifyNiche('a'.repeat(45) + ' bcdefgh');
  assert.ok(s.length <= 50);
  assert.ok(!s.endsWith('-'));
});

test('empty/garbage input -> empty string', () => {
  assert.equal(slugifyNiche('!!!'), '');
  assert.equal(slugifyNiche(''), '');
  assert.equal(slugifyNiche(null), '');
});

// Every profile save merges THIS app's keywords into its niche, new-first:
// the freshest app's own language drives the next mine, older keywords stay
// as the tail. Niche keywords stop being whatever the first app happened to set.

test('mergeKeywords: fresh lead, existing kept, deduped case-insensitively', () => {
  const merged = mergeKeywords(
    ['calorie deficit tips', 'Macro Tracking for beginners'],
    ['what i eat in a day', 'macro tracking for beginners', 'weight loss mistakes'],
  );
  assert.deepEqual(merged, [
    'calorie deficit tips',
    'Macro Tracking for beginners',
    'what i eat in a day',
    'weight loss mistakes',
  ]);
});

test('mergeKeywords caps the list', () => {
  assert.deepEqual(mergeKeywords(['a', 'b', 'c'], ['d', 'e', 'f', 'g'], 5), ['a', 'b', 'c', 'd', 'e']);
});

test('mergeKeywords tolerates junk input', () => {
  assert.deepEqual(mergeKeywords(null, ['keep me']), ['keep me']);
  assert.deepEqual(mergeKeywords(['  ', '', 'ok'], undefined), ['ok']);
  assert.deepEqual(mergeKeywords([], []), []);
});
