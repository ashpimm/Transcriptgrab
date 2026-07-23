import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/mine.js';

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('fresh rebuilds require one explicit niche', async () => {
  process.env.ADMIN_SECRET = 'admin-test';
  process.env.YOUTUBE_API_KEY = 'youtube-test';
  const res = response();
  await handler({
    method: 'GET',
    headers: {},
    query: { secret: 'admin-test', fresh: '1' },
  }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /explicit niche/i);
});

test('a real fresh rebuild requires the admin secret, not cron auth', async () => {
  process.env.CRON_SECRET = 'cron-test';
  process.env.ADMIN_SECRET = 'admin-test';
  process.env.YOUTUBE_API_KEY = 'youtube-test';
  const res = response();
  await handler({
    method: 'GET',
    headers: { authorization: 'Bearer cron-test' },
    query: { niche: 'fitness-weight-loss', fresh: '1' },
  }, res);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /ADMIN_SECRET/);
});

test('niche repair uses ADMIN_SECRET, never the cron bearer', async () => {
  process.env.CRON_SECRET = 'cron-test';
  process.env.ADMIN_SECRET = 'admin-test';
  delete process.env.YOUTUBE_API_KEY;
  const res = response();
  await handler({
    method: 'GET',
    headers: { authorization: 'Bearer cron-test' },
    query: { action: 'repair-niches' },
  }, res);
  assert.equal(res.statusCode, 401);
  assert.match(res.body.error, /ADMIN_SECRET/);
});

test('niche repair mutation is POST-only and needs the exact confirmation', async () => {
  process.env.ADMIN_SECRET = 'admin-test';
  const res = response();
  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer admin-test' },
    query: { action: 'repair-niches' },
    body: { action: 'repair-niches', confirm: 'almost' },
  }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /REPAIR_NICHES/);

  const wrongMethod = response();
  await handler({
    method: 'PUT',
    headers: { authorization: 'Bearer admin-test' },
    query: { action: 'repair-niches' },
  }, wrongMethod);
  assert.equal(wrongMethod.statusCode, 405);
});

test('legacy niches cannot consume mining quota during the rollout window', async () => {
  process.env.ADMIN_SECRET = 'admin-test';
  process.env.YOUTUBE_API_KEY = 'youtube-test';
  const res = response();
  await handler({
    method: 'GET',
    headers: { authorization: 'Bearer admin-test' },
    query: { niche: 'appdev', dry: '1', fresh: '1' },
  }, res);
  assert.equal(res.statusCode, 410);
  assert.match(res.body.error, /legacy niche is retired/i);
});
