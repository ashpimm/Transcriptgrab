import test from 'node:test';
import assert from 'node:assert';
import {
  evaluateAnonThrottle, hashIp, clientIp, parseAnonId, newAnonToken,
  anonEnabled, anonDailyCap, resolveActor,
} from '../api/_anon.js';

test('throttle disabled', () => {
  assert.deepEqual(
    evaluateAnonThrottle({ enabled: false, ipHasComplete: false, dailyComplete: 0, cap: 75 }),
    { allowed: false, reason: 'disabled' });
});

test('throttle ip already used', () => {
  assert.deepEqual(
    evaluateAnonThrottle({ enabled: true, ipHasComplete: true, dailyComplete: 0, cap: 75 }),
    { allowed: false, reason: 'ip-used' });
});

test('throttle daily cap hit', () => {
  assert.deepEqual(
    evaluateAnonThrottle({ enabled: true, ipHasComplete: false, dailyComplete: 75, cap: 75 }),
    { allowed: false, reason: 'daily-cap' });
});

test('throttle allows fresh ip under cap', () => {
  assert.deepEqual(
    evaluateAnonThrottle({ enabled: true, ipHasComplete: false, dailyComplete: 10, cap: 75 }),
    { allowed: true, reason: null });
});

test('hashIp deterministic + salted', () => {
  process.env.ANON_IP_SALT = 'testsalt';
  const a = hashIp('1.2.3.4');
  const b = hashIp('1.2.3.4');
  assert.equal(a, b);
  assert.equal(a.length, 64);
  assert.notEqual(a, hashIp('1.2.3.5'));
});

test('hashIp empty without ip', () => {
  process.env.ANON_IP_SALT = 'testsalt';
  assert.equal(hashIp(''), '');
});

test('hashIp empty without salt', () => {
  delete process.env.ANON_IP_SALT;
  assert.equal(hashIp('1.2.3.4'), '');
  process.env.ANON_IP_SALT = 'testsalt';
});

test('clientIp reads x-real-ip only', () => {
  assert.equal(clientIp({ headers: { 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1' } }), '9.9.9.9');
  assert.equal(clientIp({ headers: {} }), '');
});

test('anonDailyCap default + override', () => {
  delete process.env.ANON_DAILY_CAP;
  assert.equal(anonDailyCap(), 75);
  process.env.ANON_DAILY_CAP = '40';
  assert.equal(anonDailyCap(), 40);
  delete process.env.ANON_DAILY_CAP;
});

test('anonEnabled tracks salt', () => {
  process.env.ANON_IP_SALT = 'x';
  assert.equal(anonEnabled(), true);
  delete process.env.ANON_IP_SALT;
  assert.equal(anonEnabled(), false);
  process.env.ANON_IP_SALT = 'testsalt';
});

test('parseAnonId requires 64 hex', () => {
  const good = 'a'.repeat(64);
  assert.equal(parseAnonId({ headers: { cookie: 'tg_anon=' + good } }), good);
  assert.equal(parseAnonId({ headers: { cookie: 'tg_anon=short' } }), null);
  assert.equal(parseAnonId({ headers: {} }), null);
});

test('newAnonToken is 64 hex', () => {
  assert.match(newAnonToken(), /^[0-9a-f]{64}$/);
});

// ---- resolveActor (identity only) ----

function mkRes() {
  const headers = {};
  return {
    getHeader: (k) => headers[k],
    setHeader: (k, v) => { headers[k] = v; },
    _headers: headers,
  };
}

test('resolveActor returns user when session exists', async () => {
  process.env.ANON_IP_SALT = 'testsalt';
  const res = mkRes();
  const out = await resolveActor({ headers: {} }, res, { getSession: async () => ({ id: 7 }) });
  assert.equal(out.kind, 'user');
  assert.equal(out.user.id, 7);
});

test('resolveActor mints anon when no session + enabled', async () => {
  process.env.ANON_IP_SALT = 'testsalt';
  const res = mkRes();
  const out = await resolveActor({ headers: {} }, res, { getSession: async () => null });
  assert.equal(out.kind, 'anon');
  assert.match(out.anonId, /^[0-9a-f]{64}$/);
  assert.equal(out.minted, true);
  assert.match(String(res._headers['Set-Cookie']), /tg_anon=/);
});

test('resolveActor reuses existing anon cookie', async () => {
  process.env.ANON_IP_SALT = 'testsalt';
  const good = 'b'.repeat(64);
  const res = mkRes();
  const out = await resolveActor({ headers: { cookie: 'tg_anon=' + good } }, res, { getSession: async () => null });
  assert.equal(out.kind, 'anon');
  assert.equal(out.anonId, good);
  assert.equal(out.minted, false);
});

test('resolveActor returns none when anon disabled', async () => {
  delete process.env.ANON_IP_SALT;
  const res = mkRes();
  const out = await resolveActor({ headers: {} }, res, { getSession: async () => null });
  assert.equal(out.kind, 'none');
  assert.equal(out.reason, 'disabled');
  process.env.ANON_IP_SALT = 'testsalt';
});
