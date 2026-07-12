import test from 'node:test';
import assert from 'node:assert';
import { postKind, buildPlanPayload } from '../api/_generate.js';

test('postKind: every 4th post is a showcase (75/25 mix)', () => {
  assert.equal(postKind(0), 'value');
  assert.equal(postKind(1), 'value');
  assert.equal(postKind(2), 'value');
  assert.equal(postKind(3), 'showcase');
  assert.equal(postKind(7), 'showcase');
  assert.equal(postKind(8), 'value');
});

test('buildPlanPayload carries audience niche + kind', () => {
  const p = buildPlanPayload({
    profile: { name: 'CalSnap', what: 'AI calorie counter', who: 'people losing weight', benefit: 'log meals from a photo', tone: 'casual', audience_niche: { slug: 'fitness-weight-loss', name: 'Fitness & Weight Loss' } },
    hook: { hook_template: '5 things I wish I knew before ___', hook_verbatim: '', topic: 'lessons list' },
    kind: 'showcase',
    slideCount: 6,
  });
  assert.equal(p.audienceNiche, 'Fitness & Weight Loss');
  assert.equal(p.kind, 'showcase');
  assert.equal(p.slideCount, 6);
  assert.equal(p.app.name, 'CalSnap');
  assert.equal(p.hook.template, '5 things I wish I knew before ___');
});
