// Cron endpoint auth: Vercel sends Authorization: Bearer ${CRON_SECRET}
// (documented) — the x-vercel-cron header is undocumented and can't be the
// only gate. Manual runs use ?secret=$ADMIN_SECRET.
import test from 'node:test';
import assert from 'node:assert/strict';
import { adminSecretOk, cronAuthOk } from '../api/_shared.js';

const req = (headers = {}, query = {}) => ({ headers, query });

test('accepts documented Vercel cron auth: Bearer CRON_SECRET', () => {
  process.env.CRON_SECRET = 'cs-test';
  process.env.ADMIN_SECRET = 'as-test';
  assert.equal(cronAuthOk(req({ authorization: 'Bearer cs-test' })), true);
});

test('does not trust a spoofable x-vercel-cron header', () => {
  process.env.CRON_SECRET = 'cs-test';
  assert.equal(cronAuthOk(req({ 'x-vercel-cron': '1' })), false);
});

test('accepts admin secret query for manual runs', () => {
  process.env.ADMIN_SECRET = 'as-test';
  assert.equal(cronAuthOk(req({}, { secret: 'as-test' })), true);
  assert.equal(adminSecretOk(req({}, { secret: 'as-test' })), true);
});

test('accepts ADMIN_SECRET as a bearer token for safer manual runs', () => {
  process.env.ADMIN_SECRET = 'as-test';
  assert.equal(cronAuthOk(req({ authorization: 'Bearer as-test' })), true);
  assert.equal(adminSecretOk(req({ authorization: 'Bearer as-test' })), true);
});

test('admin-only actions do not accept the cron bearer', () => {
  process.env.CRON_SECRET = 'cs-test';
  process.env.ADMIN_SECRET = 'as-test';
  assert.equal(cronAuthOk(req({ authorization: 'Bearer cs-test' })), true);
  assert.equal(adminSecretOk(req({ authorization: 'Bearer cs-test' })), false);
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
