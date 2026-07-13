import test from 'node:test';
import assert from 'node:assert';
import { postKind, buildPlanPayload, cleanCta, pickTone, TONES } from '../api/_generate.js';

test('postKind: every 4th post is a showcase (75/25 mix)', () => {
  assert.equal(postKind(0), 'value');
  assert.equal(postKind(1), 'value');
  assert.equal(postKind(2), 'value');
  assert.equal(postKind(3), 'showcase');
  assert.equal(postKind(7), 'showcase');
  assert.equal(postKind(8), 'value');
});

const PROFILE = {
  name: 'CalSnap',
  what: 'AI calorie counter',
  who: 'people losing weight',
  benefit: 'log meals from a photo',
  audience_niche: { slug: 'fitness-weight-loss', name: 'Fitness & Weight Loss' },
};

test('buildPlanPayload carries audience niche + kind', () => {
  const p = buildPlanPayload({
    profile: PROFILE,
    hook: { hook_template: '5 things I wish I knew before ___', hook_verbatim: '', topic: 'lessons list' },
    kind: 'showcase',
    slideCount: 6,
    tone: 'funny',
  });
  assert.equal(p.audienceNiche, 'Fitness & Weight Loss');
  assert.equal(p.kind, 'showcase');
  assert.equal(p.slideCount, 6);
  assert.equal(p.product.name, 'CalSnap');
  assert.equal(p.hook.template, '5 things I wish I knew before ___');
});

// Tone is chosen per generation, not pinned on the profile: 30 autopilot posts
// a month in one voice reads like a bot.
test('buildPlanPayload takes the tone it is given, never the profile', () => {
  const p = buildPlanPayload({
    profile: { ...PROFILE, tone: 'professional' }, // a stale value from an old save
    hook: { hook_template: '___', hook_verbatim: '', topic: '' },
    kind: 'value',
    slideCount: 6,
    tone: 'funny',
  });
  assert.equal(p.product.tone, 'funny');
});

test('pickTone returns a valid tone and does not always return the same one', () => {
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    const t = pickTone();
    assert.ok(TONES.includes(t), `${t} is not a known tone`);
    seen.add(t);
  }
  assert.ok(seen.size > 1, 'tone never varied across 60 generations');
});

test('cleanCta keeps a short ask, drops URLs, clamps length', () => {
  assert.equal(cleanCta('Get CalSnap. Link in bio.'), 'Get CalSnap. Link in bio.');
  assert.equal(cleanCta('  Try   CalSnap \n free '), 'Try CalSnap free');
  // A slide is an image: a typed-out URL is unclickable noise, and a scraped
  // profile could steer one in.
  assert.equal(cleanCta('Go to https://calsnap.com'), '');
  assert.equal(cleanCta('calsnap.com — link in bio'), '');
  assert.equal(cleanCta(''), '');
  assert.equal(cleanCta(null), '');
  assert.ok(cleanCta('x'.repeat(200)).length <= 60);
});
