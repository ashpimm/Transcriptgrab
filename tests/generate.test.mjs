import test from 'node:test';
import assert from 'node:assert';
import {
  postKind, buildPlanPayload, cleanCta, pickTone, TONES,
  buildHookPickPayload, resolveHookPick, excludeHooks, retryablePlanError,
} from '../api/_generate.js';

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

// Best-fit hook selection: the model ranks the pool for THIS app, we random-
// pick among its picks. Same niche pool, different apps -> different hooks.
const POOL = [
  { id: 7, hook_verbatim: 'WHY are people LIKE THIS in the gym??', hook_template: 'WHY are people LIKE THIS in the ___??', topic: 'gym etiquette', views: 3_400_000 },
  { id: 9, hook_verbatim: 'Macros for Dummies Easy Macro Calculation!', hook_template: '___ for Dummies Easy ___ Calculation!', topic: 'macro calculation', views: 920_000 },
  { id: 12, hook_verbatim: 'High Protein Burger Bowls -Crockpot Meal Prep (8 Meals)', hook_template: 'High Protein ___ Bowls -Crockpot Meal Prep (___ Meals)', topic: 'meal prep', views: 12_000_000 },
];

test('buildHookPickPayload sends the product + candidate hooks with ids', () => {
  const p = buildHookPickPayload(PROFILE, POOL);
  assert.equal(p.product.name, 'CalSnap');
  assert.equal(p.product.what, 'AI calorie counter');
  assert.equal(p.audienceNiche, 'Fitness & Weight Loss');
  assert.equal(p.hooks.length, 3);
  assert.deepEqual(Object.keys(p.hooks[0]).sort(), ['hook', 'id', 'topic', 'views']);
  assert.equal(p.hooks[0].id, 7);
  assert.equal(p.hooks[0].hook, 'WHY are people LIKE THIS in the gym??');
  assert.equal(p.hooks[0].views, 3_400_000);
});

test('resolveHookPick keeps only pool ids, in the model\'s order, deduped', () => {
  const picked = resolveHookPick(POOL, { ids: [9, 999, 7, 9] });
  assert.deepEqual(picked.map((h) => h.id), [9, 7]);
});

test('resolveHookPick returns [] on garbage so callers fall back to random', () => {
  assert.deepEqual(resolveHookPick(POOL, null), []);
  assert.deepEqual(resolveHookPick(POOL, {}), []);
  assert.deepEqual(resolveHookPick(POOL, { ids: 'nope' }), []);
  assert.deepEqual(resolveHookPick(POOL, { ids: [999] }), []);
});

// {ids: []} is a VALID verdict — the model examined the pool and rejected all
// of it (nothing transplants onto this product). Distinct from garbage: the
// caller swaps to curated patterns instead of random-picking a bad-fit hook.
test('resolveHookPick: explicit empty ids is a valid all-rejected verdict', () => {
  assert.deepEqual(resolveHookPick(POOL, { ids: [] }), []);
});

// Repetition guard: a 2-hook pool produced three near-identical decks in a
// row. Hooks used by the user's recent carousels leave the pool — unless that
// would empty it (a tiny pool must still generate SOMETHING).
test('excludeHooks drops recently used hooks', () => {
  assert.deepEqual(excludeHooks(POOL, [9]).map((h) => h.id), [7, 12]);
  assert.deepEqual(excludeHooks(POOL, []).map((h) => h.id), [7, 9, 12]);
  assert.deepEqual(excludeHooks(POOL, null).map((h) => h.id), [7, 9, 12]);
});

test('excludeHooks never empties the pool', () => {
  assert.deepEqual(excludeHooks(POOL, [7, 9, 12]).map((h) => h.id), [7, 9, 12]);
});

test('buildPlanPayload carries product facts for slide substance', () => {
  const p = buildPlanPayload({
    profile: { ...PROFILE, facts: ['photo logging in under 5 seconds', 'supports 40+ diets'] },
    hook: { hook_template: '___', hook_verbatim: '', topic: '' },
    kind: 'value',
    slideCount: 6,
    tone: 'casual',
  });
  assert.deepEqual(p.product.facts, ['photo logging in under 5 seconds', 'supports 40+ diets']);
  // absent facts -> empty array, never undefined (prompt contract)
  const q = buildPlanPayload({ profile: PROFILE, hook: { hook_template: '___' }, kind: 'value', slideCount: 6, tone: 'casual' });
  assert.deepEqual(q.product.facts, []);
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

test('carousel planning retries malformed, empty, rate-limited, and transient responses only', () => {
  assert.equal(retryablePlanError(new Error('AI returned an invalid response. Please try again.')), true);
  assert.equal(retryablePlanError(new Error('Empty response from AI service.')), true);
  assert.equal(retryablePlanError(new Error('AI error (429): rate limit')), true);
  assert.equal(retryablePlanError(new Error('AI error (503): unavailable')), true);
  assert.equal(retryablePlanError(new Error('AI error (400): bad request')), false);
  assert.equal(retryablePlanError(new Error('No hooks available yet')), false);
});
