import test from 'node:test';
import assert from 'node:assert';
import { slugifyNiche } from '../api/_db.js';

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
