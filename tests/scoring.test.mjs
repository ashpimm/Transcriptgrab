import test from 'node:test';
import assert from 'node:assert';
import {
  computeOutlierScore, isHighReachCandidate, compareCandidateReach,
  isMostlyLatin, publishedAfterISO,
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

test('high-reach qualification ignores creator size', () => {
  assert.equal(isHighReachCandidate(250000), true);
  assert.equal(isHighReachCandidate(249999), false);
  assert.equal(isHighReachCandidate(2_000_000), true);
});

test('reach ranking puts mass views ahead of a tiny-account ratio', () => {
  const candidates = [
    { views: 300_000, score: 3000 },
    { views: 10_000_000, score: 2 },
    { views: 2_000_000, score: 20 },
  ].sort(compareCandidateReach);
  assert.deepEqual(candidates.map((c) => c.views), [10_000_000, 2_000_000, 300_000]);
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
