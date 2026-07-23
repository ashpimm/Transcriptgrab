import test from 'node:test';
import assert from 'node:assert/strict';
import { LAUNCH_NICHE_SLUGS } from '../api/_niches.js';
import {
  enforceSearchRequestBudget,
  MAX_SEARCH_REQUESTS_PER_NICHE,
  selectNiches,
  summarize,
} from '../scripts/fresh-mine.mjs';

test('runner marks every unexpected non-2xx response as failed', () => {
  assert.equal(summarize({ canApplyFresh: false }, 500, false).outcome, 'FAILED');
  assert.equal(summarize({ error: 'Forbidden' }, 403, true).outcome, 'FAILED');
});

test('runner treats only an apply 409 as safe preservation', () => {
  assert.equal(summarize({ freshBlockers: ['not enough hooks'] }, 409, true).outcome, 'KEPT EXISTING');
  assert.equal(summarize({ freshBlockers: ['not enough hooks'] }, 409, false).outcome, 'FAILED');
});

test('runner reports soft retirement counts for preview and apply', () => {
  assert.equal(summarize({ wouldRetire: ['one', 'two'] }, 200, false).retired, 2);
  assert.equal(summarize({ applied: true, retired: 3 }, 200, true).retired, 3);
});

test('batch modes refuse to mine while a legacy niche is active', () => {
  const active = [
    ...LAUNCH_NICHE_SLUGS.map((slug) => ({ slug })),
    { slug: 'appdev' },
  ];

  assert.throws(
    () => selectNiches(active, { runAll: false, runLaunch: true, requestedSlugs: [] }),
    /legacy niches are still active.*appdev/i,
  );
});

test('launch mode follows the reviewed shared priority order', () => {
  const active = [...LAUNCH_NICHE_SLUGS]
    .reverse()
    .map((slug) => ({ slug }));
  const selected = selectNiches(active, {
    runAll: false,
    runLaunch: true,
    requestedSlugs: [],
  });

  assert.deepEqual(selected.map((niche) => niche.slug), LAUNCH_NICHE_SLUGS);
});

test('runner enforces its 90-request worst-case guard', () => {
  assert.equal(enforceSearchRequestBudget(10), 10 * MAX_SEARCH_REQUESTS_PER_NICHE);
  assert.throws(() => enforceSearchRequestBudget(11), /up to 99 YouTube search requests/i);
  assert.equal(
    enforceSearchRequestBudget(11, { allowOverBudget: true }),
    11 * MAX_SEARCH_REQUESTS_PER_NICHE,
  );
});
