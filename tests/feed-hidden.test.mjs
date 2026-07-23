import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (name) => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('the public feed is absent from navigation and indexed pages', () => {
  assert.equal(fs.existsSync(new URL('../feed.html', import.meta.url)), false);
  assert.doesNotMatch(read('nav.js'), /href=["']\/feed/);
  assert.doesNotMatch(read('index.html'), /href=["']\/feed/);
  assert.doesNotMatch(read('sitemap.xml'), /\/feed</);
  assert.doesNotMatch(read('create.html'), /href=["']\/feed/);
});

test('both feed URLs redirect to Create while the hook API stays available', () => {
  const config = JSON.parse(read('vercel.json'));
  const redirect = (source) => config.redirects.find((item) => item.source === source);
  assert.deepEqual(redirect('/feed'), { source: '/feed', destination: '/create', permanent: false });
  assert.deepEqual(redirect('/feed.html'), { source: '/feed.html', destination: '/create', permanent: false });
  assert.ok(config.rewrites.some((item) => item.source === '/api/hooks'));
  assert.ok(!config.rewrites.some((item) => item.source === '/feed'));
});
