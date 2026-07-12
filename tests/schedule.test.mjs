import test from 'node:test';
import assert from 'node:assert';
import { nextSlots } from '../api/_generate.js';

test('returns exactly N slots at 15:00 UTC, backfilling past taken days', () => {
  const now = '2026-07-13T08:00:00Z';
  const taken = [new Date('2026-07-14T15:00:00Z')];
  const slots = nextSlots(now, taken, 3);
  assert.equal(slots.length, 3); // day+1 taken -> backfills to day+3
  assert.equal(slots[0].toISOString(), '2026-07-13T15:00:00.000Z');
  assert.equal(slots[1].toISOString(), '2026-07-15T15:00:00.000Z');
  assert.equal(slots[2].toISOString(), '2026-07-16T15:00:00.000Z');
});

test('same-day slot skipped when 15:00 already past', () => {
  const slots = nextSlots('2026-07-13T16:30:00Z', [], 2);
  assert.equal(slots[0].toISOString(), '2026-07-14T15:00:00.000Z');
  assert.equal(slots[1].toISOString(), '2026-07-15T15:00:00.000Z');
});

test('steady state: one taken day ahead, need 2 -> the 2 following free days', () => {
  // Cron ran, today's post published, tomorrow still queued: n=1, need 2.
  const slots = nextSlots('2026-07-15T14:30:00Z', [new Date('2026-07-15T15:00:00Z'), new Date('2026-07-16T15:00:00Z')], 2);
  assert.equal(slots.length, 2);
  assert.equal(slots[0].toISOString(), '2026-07-17T15:00:00.000Z');
  assert.equal(slots[1].toISOString(), '2026-07-18T15:00:00.000Z');
});
