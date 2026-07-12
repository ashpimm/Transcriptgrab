import test from 'node:test';
import assert from 'node:assert';
import { nextSlots } from '../api/_generate.js';

test('fills up to N days ahead at 15:00 UTC, skipping taken days', () => {
  const now = '2026-07-13T08:00:00Z';
  const taken = [new Date('2026-07-14T15:00:00Z')];
  const slots = nextSlots(now, taken, 3);
  assert.equal(slots.length, 2); // day+1 taken -> today 15:00 + day+2
  assert.equal(slots[0].toISOString(), '2026-07-13T15:00:00.000Z');
  assert.equal(slots[1].toISOString(), '2026-07-15T15:00:00.000Z');
});

test('same-day slot skipped when 15:00 already past', () => {
  const slots = nextSlots('2026-07-13T16:30:00Z', [], 2);
  assert.equal(slots[0].toISOString(), '2026-07-14T15:00:00.000Z');
  assert.equal(slots[1].toISOString(), '2026-07-15T15:00:00.000Z');
});
