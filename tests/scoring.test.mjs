import test from 'node:test';
import assert from 'node:assert';
import { computeOutlierScore, isOutlier } from '../api/_youtube.js';

test('score = views/followers to 2dp', () => {
  assert.equal(computeOutlierScore(1000000, 80000), 12.5);
});

test('rounds to 2dp', () => {
  assert.equal(computeOutlierScore(1000, 3000), 0.33);
});

test('zero/negative followers -> 0', () => {
  assert.equal(computeOutlierScore(500, 0), 0);
  assert.equal(computeOutlierScore(500, -10), 0);
});

test('caps at 9999.99', () => {
  assert.equal(computeOutlierScore(10_000_000, 1), 9999.99);
});

test('outlier at >=5x', () => {
  assert.equal(isOutlier(400000, 80000), true); // exactly 5.0
  assert.equal(isOutlier(399999, 80000), false);
  assert.equal(isOutlier(1, 0), false);
});
