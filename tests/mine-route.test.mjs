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
