import test from 'node:test';
import assert from 'node:assert';
import {
  computeOutlierScore, isOutlier, isMostlyLatin, publishedAfterISO,
} from '../api/_youtube.js';

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

// Micro-account noise: a 1-follower channel makes every upload a 100x "outlier"
// on ratio alone, but nobody actually watched it. Views floor = proof of real
// reach; follower floor = sane denominator.
test('isOutlier floors reject micro-noise, keep real reach', () => {
  assert.equal(isOutlier(142, 1), false);        // real case: 142x ratio, 142 views
  assert.equal(isOutlier(1240, 8), false);       // real case: 5-sec silent short
  assert.equal(isOutlier(12000, 30), false);     // views fine, denominator too small
  assert.equal(isOutlier(12000, 60), true);      // small real account, real reach
  assert.equal(isOutlier(9379973, 57700), true); // 9.3M views at 162x
});

test('publishedAfterISO returns an ISO date the given days back', () => {
  const now = Date.parse('2026-07-16T00:00:00Z');
  assert.equal(publishedAfterISO(120, now), '2026-03-18T00:00:00.000Z');
  // default window is recent enough to mean "currently viral", not archives
  const days = (Date.now() - Date.parse(publishedAfterISO())) / 86400000;
  assert.ok(days <= 180, `default freshness window too wide: ${days} days`);
});

test('isMostlyLatin accepts English incl emoji/digits/punctuation', () => {
  assert.equal(isMostlyLatin('This 17-Year-Old Built a $12 Million AI App. 🚀'), true);
  assert.equal(isMostlyLatin('Créer une app sans coder'), true); // accented Latin
  assert.equal(isMostlyLatin(''), true);
  assert.equal(isMostlyLatin('123 !!!'), true); // no letters at all
});

test('isMostlyLatin rejects non-Latin-script titles', () => {
  assert.equal(isMostlyLatin('अभी यह सेलूून देखो।'), false);
  assert.equal(isMostlyLatin('टॉप थ्री ब्रोकर एप्स जो हर बड़ा ट्रेडर यूज करता है'), false);
  assert.equal(isMostlyLatin('5 मिनट में बिना कोडिंग के मोबाइल ऐप कैसे बनाएं?'), false);
  assert.equal(isMostlyLatin('如何免费制作应用程序'), false);
});

test('isMostlyLatin tolerates minor non-Latin mixed into English', () => {
  assert.equal(isMostlyLatin('Frustrated engineer built ₹290 Cr app from train delays!'), true);
});
