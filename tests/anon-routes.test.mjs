import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

const profileSrc = fs.readFileSync(new URL('../api/profile.js', import.meta.url), 'utf8');
const carouselSrc = fs.readFileSync(new URL('../api/carousel.js', import.meta.url), 'utf8');

// ---- profile.js ----

test('profile.js resolves an actor and imports anon helpers', () => {
  assert.match(profileSrc, /from '\.\/_anon\.js'/);
  assert.match(profileSrc, /resolveActor/);
  assert.match(profileSrc, /reserveAnonSlot/);
  assert.match(profileSrc, /attachAnonProfile/);
  assert.match(profileSrc, /getAnonProfile/);
});

test('profile.js gates import + save on the throttle', () => {
  // Both money-costing actions call the reserve gate.
  const importBlock = profileSrc.match(/if \(action === 'import'\)[\s\S]*?\n  \}/)?.[0] || '';
  const saveBlock = profileSrc.match(/if \(action === 'save'\)[\s\S]*?profilePut/)?.[0] || '';
  assert.match(importBlock, /anonReserveGate/);
  assert.match(saveBlock, /anonReserveGate/);
});

test('profile.js gate returns the sign-in signal', () => {
  assert.match(profileSrc, /error: 'gate'/);
});

test('profile.js never reads getProfile(user.id) when user may be null in save', () => {
  // save uses profileGet()/profilePut() rather than the raw user.id calls.
  assert.match(profileSrc, /profileGet\(\)/);
  assert.match(profileSrc, /profilePut\(cleaned\)/);
});

// ---- carousel.js ----

test('carousel.js resolves an actor and imports anon helpers', () => {
  assert.match(carouselSrc, /from '\.\/_anon\.js'/);
  assert.match(carouselSrc, /resolveActor/);
  assert.match(carouselSrc, /getAnonProfile/);
  assert.match(carouselSrc, /completeAnonSlot/);
  assert.match(carouselSrc, /releaseAnonSlot/);
});

test('carousel.js forces watermark for anon plan', () => {
  const planBlock = carouselSrc.match(/if \(action === 'plan'\)[\s\S]*?source: 'anon', watermark: true/)?.[0] || '';
  assert.ok(planBlock.length > 0, 'anon plan gate not found');
  assert.match(planBlock, /source: 'anon', watermark: true/);
});

test('carousel.js saves anon carousel with anonId + completes the slot', () => {
  assert.match(carouselSrc, /saveCarousel\(\s*\n?\s*user \? user\.id : null[\s\S]*?anonId,/);
  assert.match(carouselSrc, /completeAnonSlot\(\{ anonId, carouselId: saved\.id \}\)/);
});

test('carousel.js releases the slot when plan generation fails', () => {
  assert.match(carouselSrc, /if \(anonId\) await releaseAnonSlot\(anonId\)/);
});

test('carousel.js keeps reel Pro-only (guards null user)', () => {
  assert.match(carouselSrc, /if \(!user \|\| user\.tier !== 'pro'\)/);
});
