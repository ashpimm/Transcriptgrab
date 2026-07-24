import test from 'node:test';
import assert from 'node:assert';
import { nextSlots } from '../api/_generate.js';

// Slot = 20:00 UTC (5:30 AM ACST): post comes due just before the 20:30 UTC
// cron publishes it at 6:00 AM Adelaide time, when people wake up and scroll.
test('returns exactly N slots at 20:00 UTC, backfilling past taken days', () => {
  const now = '2026-07-13T08:00:00Z';
  const taken = [new Date('2026-07-14T20:00:00Z')];
  const slots = nextSlots(now, taken, 3);
  assert.equal(slots.length, 3); // day+1 taken -> backfills to day+3
  assert.equal(slots[0].toISOString(), '2026-07-13T20:00:00.000Z');
  assert.equal(slots[1].toISOString(), '2026-07-15T20:00:00.000Z');
  assert.equal(slots[2].toISOString(), '2026-07-16T20:00:00.000Z');
});

test('same-day slot skipped when 20:00 already past', () => {
  const slots = nextSlots('2026-07-13T21:30:00Z', [], 2);
  assert.equal(slots[0].toISOString(), '2026-07-14T20:00:00.000Z');
  assert.equal(slots[1].toISOString(), '2026-07-15T20:00:00.000Z');
});

test('steady state: one taken day ahead, need 2 -> the 2 following free days', () => {
  // Cron ran, today's post published, tomorrow still queued: n=1, need 2.
  const slots = nextSlots('2026-07-15T19:30:00Z', [new Date('2026-07-15T20:00:00Z'), new Date('2026-07-16T20:00:00Z')], 2);
  assert.equal(slots.length, 2);
  assert.equal(slots[0].toISOString(), '2026-07-17T20:00:00.000Z');
  assert.equal(slots[1].toISOString(), '2026-07-18T20:00:00.000Z');
});

// Per-user posting slot: the 4th argument is the cron fire time ('HH:MM' UTC);
// posts are scheduled 30 minutes before it so claimDuePosts sees them due on
// the intended fire and never the one before.
test('custom slot 08:30 schedules at 08:00 UTC', () => {
  const slots = nextSlots('2026-07-13T02:00:00Z', [], 2, '08:30');
  assert.equal(slots[0].toISOString(), '2026-07-13T08:00:00.000Z');
  assert.equal(slots[1].toISOString(), '2026-07-14T08:00:00.000Z');
});

test('custom slot 02:30 wraps to 02:00 and skips same day when past', () => {
  const slots = nextSlots('2026-07-13T03:00:00Z', [], 1, '02:30');
  assert.equal(slots[0].toISOString(), '2026-07-14T02:00:00.000Z');
});

test('slot omitted or invalid falls back to legacy 20:00 UTC', () => {
  assert.equal(nextSlots('2026-07-13T08:00:00Z', [], 1)[0].toISOString(), '2026-07-13T20:00:00.000Z');
  assert.equal(nextSlots('2026-07-13T08:00:00Z', [], 1, 'garbage')[0].toISOString(), '2026-07-13T20:00:00.000Z');
});

test('taken-day collision respected under custom slot', () => {
  const slots = nextSlots('2026-07-13T02:00:00Z', [new Date('2026-07-13T14:00:00.000Z')], 1, '14:30');
  assert.equal(slots[0].toISOString(), '2026-07-14T14:00:00.000Z');
});
