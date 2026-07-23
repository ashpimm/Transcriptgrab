import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_FRESH_ACCEPTED_HOOKS, MIN_FRESH_TRANSCRIPT_ELIGIBLE,
  assessFreshReadiness, excludeCrossNicheRows, selectResearchPool,
  validateHookExtraction,
} from '../api/_miner.js';

const transcript = 'Hey guys, welcome back. I deleted three apps and finally got my mornings back. The first one was the worst offender.';
const good = {
  relevant: true,
  language: 'en',
  transferable: true,
  is_ad: false,
  quality_score: 5,
  hook_verbatim: 'I deleted three apps and finally got my mornings back.',
  hook_template: 'I deleted ___ and finally got my mornings back.',
  topic: 'digital habit reset',
};

test('accepts a strong hook grounded near the transcript opening', () => {
  assert.deepEqual(validateHookExtraction(good, transcript), { ok: true, reason: '' });
});

test('rejects a title-derived line that is absent from the transcript', () => {
  const titleCopy = {
    ...good,
    hook_verbatim: 'The Ultimate Productivity Guide You Will Ever Need',
    hook_template: 'The Ultimate ___ Guide You Will Ever Need',
  };
  assert.equal(validateHookExtraction(titleCopy, transcript).reason, 'not grounded in opening transcript');
});

test('requires explicit relevance, English, transferability, and quality', () => {
  assert.equal(validateHookExtraction({ ...good, relevant: undefined }, transcript).reason, 'off-niche');
  assert.equal(validateHookExtraction({ ...good, language: 'es' }, transcript).reason, 'non-English');
  assert.equal(validateHookExtraction({ ...good, transferable: false }, transcript).reason, 'not transferable');
  assert.equal(validateHookExtraction({ ...good, is_ad: true }, transcript).reason, 'advertising or promotion');
  assert.equal(validateHookExtraction({ ...good, is_ad: undefined }, transcript).reason, 'advertising or promotion');
  assert.equal(validateHookExtraction({ ...good, quality_score: 3 }, transcript).reason, 'weak opening');
});

test('rejects fragments even when their words appear in the transcript', () => {
  const fragment = {
    ...good,
    hook_verbatim: 'I deleted apps.',
    hook_template: 'I deleted ___ and got mornings back.',
  };
  assert.equal(validateHookExtraction(fragment, transcript).reason, 'bad hook length');
});

test('rejects templates invented from a different hook', () => {
  const invented = {
    ...good,
    hook_template: 'The secret ___ that changed my whole morning.',
  };
  assert.equal(validateHookExtraction(invented, transcript).reason, 'template not derived from hook');
});

test('routine mines extract only unseen sources', () => {
  const candidates = [{ url: 'https://example.com/saved' }, { url: 'https://example.com/new' }];
  const existing = new Set(['https://example.com/saved']);
  assert.deepEqual(
    selectResearchPool(candidates, existing).map((candidate) => candidate.url),
    ['https://example.com/new'],
  );
});

test('dry and fresh mines re-evaluate the complete candidate pool', () => {
  const candidates = [{ url: 'https://example.com/saved' }, { url: 'https://example.com/new' }];
  const existing = new Set(['https://example.com/saved']);
  assert.deepEqual(selectResearchPool(candidates, existing, { dry: true }), candidates);
  assert.deepEqual(selectResearchPool(candidates, existing, { fresh: true }), candidates);
});

test('fresh rebuilds require a minimally useful accepted pool', () => {
  assert.equal(MIN_FRESH_ACCEPTED_HOOKS, 3);
  assert.equal(MIN_FRESH_TRANSCRIPT_ELIGIBLE, 6);
  assert.deepEqual(assessFreshReadiness({
    accepted: 3,
    transcriptEligible: 6,
    evaluated: 6,
  }), { canApply: true, blockers: [] });
});

test('fresh rebuilds refuse partial discovery, upstream, and extraction runs', () => {
  assert.equal(assessFreshReadiness({
    accepted: 5,
    transcriptEligible: 8,
    evaluated: 8,
    discoveryFailures: 1,
  }).canApply, false);
  assert.equal(assessFreshReadiness({
    accepted: 5,
    transcriptEligible: 8,
    evaluated: 8,
    upstreamFailures: 1,
  }).canApply, false);
  assert.equal(assessFreshReadiness({
    accepted: 5,
    transcriptEligible: 8,
    evaluated: 7,
  }).canApply, false);
});

test('fresh rebuilds do not steal a globally-owned video from another niche', () => {
  const owned = excludeCrossNicheRows(
    [{ videoUrl: 'same-niche' }, { videoUrl: 'other-niche' }, { videoUrl: 'new' }],
    new Set(['same-niche', 'other-niche']),
    new Set(['same-niche']),
  );
  assert.deepEqual(owned.rows.map((row) => row.videoUrl), ['same-niche', 'new']);
  assert.deepEqual(owned.conflicts, ['other-niche']);
});
