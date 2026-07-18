// Cron endpoint auth: Vercel sends Authorization: Bearer ${CRON_SECRET}
// (documented) — the x-vercel-cron header is undocumented and can't be the
// only gate. Manual runs use ?secret=$ADMIN_SECRET.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cronAuthOk } from '../api/_shared.js';

const req = (headers = {}, query = {}) => ({ headers, query });

test('accepts documented Vercel cron auth: Bearer CRON_SECRET', () => {
  process.env.CRON_SECRET = 'cs-test';
  process.env.ADMIN_SECRET = 'as-test';
  assert.equal(cronAuthOk(req({ authorization: 'Bearer cs-test' })), true);
});

test('accepts legacy x-vercel-cron header', () => {
  process.env.CRON_SECRET = 'cs-test';
  assert.equal(cronAuthOk(req({ 'x-vercel-cron': '1' })), true);
});

test('accepts admin secret query for manual runs', () => {
  process.env.ADMIN_SECRET = 'as-test';
  assert.equal(cronAuthOk(req({}, { secret: 'as-test' })), true);
});

test('rejects wrong bearer, wrong query secret, and bare requests', () => {
  process.env.CRON_SECRET = 'cs-test';
  process.env.ADMIN_SECRET = 'as-test';
  assert.equal(cronAuthOk(req({ authorization: 'Bearer nope' })), false);
  assert.equal(cronAuthOk(req({}, { secret: 'nope' })), false);
  assert.equal(cronAuthOk(req()), false);
});

test('rejects bearer when CRON_SECRET unset (no empty-string match)', () => {
  delete process.env.CRON_SECRET;
  delete process.env.ADMIN_SECRET;
  assert.equal(cronAuthOk(req({ authorization: 'Bearer ' })), false);
  assert.equal(cronAuthOk(req({}, { secret: undefined })), false);
});
