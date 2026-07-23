import test from 'node:test';
import assert from 'node:assert/strict';
import { validateHookExtraction } from '../api/_miner.js';

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
