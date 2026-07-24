// Admin dashboard auth gate: header-only bearer with constant-time compare,
// Google-session email allowlist, and the cost math the spend log stores.
import test from 'node:test';
import assert from 'node:assert/strict';

import { adminBearerOk, isAdminRequest, ADMIN_EMAILS } from '../api/_admin.js';
import { geminiTextCostMicros, GEMINI_IMAGE_COST_MICROS } from '../api/_shared.js';

test('adminBearerOk rejects everything when ADMIN_SECRET is unset', () => {
  delete process.env.ADMIN_SECRET;
  assert.equal(adminBearerOk({ headers: { authorization: 'Bearer anything' } }), false);
});

test('adminBearerOk accepts the exact bearer header', () => {
  process.env.ADMIN_SECRET = 'as-admin-test';
  assert.equal(adminBearerOk({ headers: { authorization: 'Bearer as-admin-test' } }), true);
});

test('adminBearerOk rejects wrong secrets, including different lengths', () => {
  process.env.ADMIN_SECRET = 'as-admin-test';
  assert.equal(adminBearerOk({ headers: { authorization: 'Bearer wrong-secret' } }), false);
  assert.equal(adminBearerOk({ headers: { authorization: 'Bearer as-admin-tes' } }), false);
  assert.equal(adminBearerOk({ headers: {} }), false);
});

test('adminBearerOk never accepts the query-string secret', () => {
  process.env.ADMIN_SECRET = 'as-admin-test';
  assert.equal(adminBearerOk({ headers: {}, query: { secret: 'as-admin-test' } }), false);
});

test('isAdminRequest passes on a valid bearer without touching the session', async () => {
  const ok = await isAdminRequest({ headers: {} }, {
    adminBearerOk: () => true,
    getSession: async () => { throw new Error('must not be called'); },
  });
  assert.equal(ok, true);
});

test('isAdminRequest allows an allowlisted Google session email', async () => {
  const ok = await isAdminRequest({ headers: {} }, {
    adminBearerOk: () => false,
    getSession: async () => ({ email: ADMIN_EMAILS[0].toUpperCase() }),
  });
  assert.equal(ok, true);
});

test('isAdminRequest rejects other signed-in users', async () => {
  const ok = await isAdminRequest({ headers: {} }, {
    adminBearerOk: () => false,
    getSession: async () => ({ email: 'stranger@example.com' }),
  });
  assert.equal(ok, false);
});

test('isAdminRequest fails closed when the session lookup throws', async () => {
  const ok = await isAdminRequest({ headers: {} }, {
    adminBearerOk: () => false,
    getSession: async () => { throw new Error('db down'); },
  });
  assert.equal(ok, false);
});

test('gemini text cost: $0.30/M input, $2.50/M output, integer micros', () => {
  assert.equal(geminiTextCostMicros(1_000_000, 0), 300_000);
  assert.equal(geminiTextCostMicros(0, 1_000_000), 2_500_000);
  assert.equal(geminiTextCostMicros(1000, 1000), 2800);
  assert.equal(geminiTextCostMicros(null, undefined), 0);
});

test('gemini image cost constant is $0.039', () => {
  assert.equal(GEMINI_IMAGE_COST_MICROS, 39_000);
});
