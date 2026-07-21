import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildReelEdit, reelSceneLength } from '../api/_shotstack.js';
import { reelAssetUrl, signReelAsset, verifyReelAsset } from '../api/_reel.js';

test('builds a silent 1080p 9:16 MP4 with deliberate slide timing', () => {
  const urls = ['https://example.com/0.jpg', 'https://example.com/1.jpg', 'https://example.com/2.jpg'];
  const edit = buildReelEdit(urls);
  assert.equal(edit.output.format, 'mp4');
  assert.equal(edit.output.resolution, '1080');
  assert.equal(edit.output.aspectRatio, '9:16');
  assert.equal(edit.output.mute, true);
  assert.equal(edit.timeline.soundtrack, undefined);
  const clips = edit.timeline.tracks[0].clips;
  assert.deepEqual(clips.map((clip) => clip.asset.src), urls);
  assert.deepEqual(clips.map((clip) => clip.start), [0, 4, 12.5]);
  assert.deepEqual(clips.map((clip) => clip.length), [4, 8.5, 8.5]);
  assert.ok(clips.every((clip) => clip.effect && clip.transition.in === 'fade'));
  assert.equal(reelSceneLength(0, 6), 4);
  assert.equal(reelSceneLength(5, 6), 8.5);
});

test('Reel slide asset signatures reject tampering and expiry', () => {
  const payload = { carouselId: 42, index: 2, expires: 2_000_000_000 };
  const signature = signReelAsset(payload, 'test-secret');
  assert.equal(verifyReelAsset({ ...payload, signature }, 'test-secret', 1_900_000_000_000), true);
  assert.equal(verifyReelAsset({ ...payload, index: 3, signature }, 'test-secret', 1_900_000_000_000), false);
  assert.equal(verifyReelAsset({ ...payload, signature }, 'test-secret', 2_100_000_000_000), false);
});

test('signed asset URLs carry only the bounded render coordinates', () => {
  const url = new URL(reelAssetUrl({
    baseUrl: 'https://hooklab.example', carouselId: 7, index: 1,
    expires: 2_000_000_000, secret: 'test-secret',
  }));
  assert.equal(url.pathname, '/api/carousel');
  assert.equal(url.searchParams.get('asset'), 'reel-slide');
  assert.equal(url.searchParams.get('carouselId'), '7');
  assert.equal(url.searchParams.get('index'), '1');
  assert.ok(url.searchParams.get('signature'));
});

test('create page exposes render progress, retry, and direct MP4 download states', () => {
  const source = fs.readFileSync(new URL('../create.html', import.meta.url), 'utf8');
  assert.match(source, /Create Reel \(\.mp4\)/);
  assert.match(source, /action: 'reel-status'/);
  assert.match(source, /Retry Reel render/);
  assert.match(source, /hooklab-reel\.mp4/);
  assert.match(source, /choose your song in Instagram/i);
  assert.match(source, /updateHistoryReelState/);
  assert.match(source, /Unlock Reel export with Pro/);
  const classicScripts = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.ok(classicScripts.length > 0);
  for (const script of classicScripts) assert.doesNotThrow(() => new Function(script));
});

test('Reel jobs are stored on the carousel and reclaim stale submissions', () => {
  const db = fs.readFileSync(new URL('../api/_db.js', import.meta.url), 'utf8');
  assert.match(db, /reel_render_id/);
  assert.match(db, /INTERVAL '30 minutes'/);
  const api = fs.readFileSync(new URL('../api/carousel.js', import.meta.url), 'utf8');
  assert.match(api, /verifyReelAsset/);
  assert.match(api, /reelJobIsFresh/);
  assert.match(api, /user\.tier !== 'pro'/);
  assert.match(api, /Reel downloads are included with Pro/);
});

test('landing page describes the current Pro carousel, Reel, and autopilot product', () => {
  const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(source, /downloadable 9:16 Reel/);
  assert.match(source, /Daily Instagram auto-posting/);
  assert.match(source, /whether each post succeeded/);
  assert.match(source, /How do Reel downloads work\?/);
});
