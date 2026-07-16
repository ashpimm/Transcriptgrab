// tests/uploadpost.test.mjs — parsing upload-post's profile list into linked
// platforms, and choosing which platforms a post actually ships to.
import test from 'node:test';
import assert from 'node:assert/strict';
import { linkedPlatformsFrom, effectivePlatforms } from '../api/_uploadpost.js';

// ---- linkedPlatformsFrom(data, username) ----

test('social_accounts object: only truthy entries count as linked', () => {
  const data = {
    success: true,
    profiles: [{
      username: 'hooklab-u1',
      social_accounts: {
        instagram: { username: 'hudplus.app' },
        tiktok: null,
        youtube: '',
        facebook: undefined,
      },
    }],
  };
  assert.deepEqual(linkedPlatformsFrom(data, 'hooklab-u1'), ['instagram']);
});

test('social_accounts as display-name strings: non-empty string = linked', () => {
  const data = {
    profiles: [{
      username: 'hooklab-u1',
      social_accounts: { instagram: 'hudplus.app', tiktok: '' },
    }],
  };
  assert.deepEqual(linkedPlatformsFrom(data, 'hooklab-u1'), ['instagram']);
});

test('empty-object account values count as NOT linked', () => {
  const data = {
    profiles: [{ username: 'hooklab-u1', social_accounts: { instagram: {}, tiktok: { u: 'x' } } }],
  };
  assert.deepEqual(linkedPlatformsFrom(data, 'hooklab-u1'), ['tiktok']);
});

test('array-of-strings fallback shape', () => {
  const data = {
    profiles: [{ username: 'hooklab-u1', social_accounts: ['instagram', 'tiktok'] }],
  };
  assert.deepEqual(linkedPlatformsFrom(data, 'hooklab-u1'), ['instagram', 'tiktok']);
});

test('profile missing -> null (unknown, caller falls back)', () => {
  assert.equal(linkedPlatformsFrom({ profiles: [{ username: 'other' }] }, 'hooklab-u1'), null);
});

test('unrecognized/absent social_accounts -> null (unknown)', () => {
  assert.equal(linkedPlatformsFrom({ profiles: [{ username: 'hooklab-u1' }] }, 'hooklab-u1'), null);
  assert.equal(linkedPlatformsFrom(null, 'hooklab-u1'), null);
  assert.equal(linkedPlatformsFrom({ profiles: 'nope' }, 'hooklab-u1'), null);
});

// ---- effectivePlatforms(requested, linked) ----

test('intersects requested with linked', () => {
  assert.deepEqual(effectivePlatforms(['tiktok', 'instagram'], ['instagram']), ['instagram']);
});

test('linked unknown (null) -> requested unchanged', () => {
  assert.deepEqual(effectivePlatforms(['tiktok', 'instagram'], null), ['tiktok', 'instagram']);
});

test('nothing linked -> empty array', () => {
  assert.deepEqual(effectivePlatforms(['tiktok', 'instagram'], []), []);
});
