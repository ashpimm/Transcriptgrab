import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NICHE_CLASSIFIER_VERSION,
  LEGACY_NICHE_SLUGS,
  LAUNCH_NICHE_SLUGS,
  slugifyNiche,
  canonicalNicheSlug,
  inferCanonicalNicheSlug,
  mergeNicheKeywords,
  nicheCatalogueForPrompt,
  shouldReuseStoredAudience,
  validateAudienceChoice,
} from '../api/_niches.js';

test('niche slugs are bounded lowercase kebab case', () => {
  assert.equal(slugifyNiche('Fitness & Weight Loss'), 'fitness-weight-loss');
  assert.equal(slugifyNiche('  Home -- Cooking!! '), 'home-cooking');
  const capped = slugifyNiche('a'.repeat(45) + ' bcdefgh');
  assert.ok(capped.length <= 50);
  assert.ok(!capped.endsWith('-'));
  assert.equal(slugifyNiche('!!!'), '');
  assert.equal(slugifyNiche(null), '');
});

test('known thin variants resolve into stable shared pools', () => {
  assert.equal(canonicalNicheSlug('Fitness & Nutrition'), 'fitness-weight-loss');
  assert.equal(canonicalNicheSlug('Fitness & Body Sculpting'), 'fitness-training');
  assert.equal(canonicalNicheSlug('Productivity & Digital Wellness'), 'productivity-focus');
  assert.equal(canonicalNicheSlug('Realtors'), 'real-estate-professionals');
  assert.equal(canonicalNicheSlug('App Development'), 'appdev');
  assert.equal(canonicalNicheSlug('Software Development'), 'software-development');
  assert.equal(inferCanonicalNicheSlug('Weight Loss for Women'), 'fitness-weight-loss');
  assert.equal(inferCanonicalNicheSlug('Calorie Tracking Beginners'), 'fitness-weight-loss');
  assert.equal(inferCanonicalNicheSlug("Women's Fitness"), 'fitness-training');
  assert.equal(inferCanonicalNicheSlug('Couples Budgeting'), 'personal-finance');
  assert.equal(inferCanonicalNicheSlug('Financial Wellness'), 'personal-finance');
  assert.equal(inferCanonicalNicheSlug('Pregnancy Fitness'), '');
  assert.equal(
    inferCanonicalNicheSlug('Software Development', ['developer productivity']),
    '',
  );
});

test('reviewed search terms stay first and app terms only fill the tail', () => {
  assert.deepEqual(
    mergeNicheKeywords(
      ['what i eat in a day', 'weight loss mistakes'],
      ['calorie tracking tips', 'Weight Loss Mistakes'],
    ),
    ['what i eat in a day', 'weight loss mistakes', 'calorie tracking tips'],
  );
  assert.deepEqual(
    mergeNicheKeywords(['a', 'b', 'c'], ['d', 'e', 'f', 'g'], 5),
    ['a', 'b', 'c', 'd', 'e'],
  );
  assert.deepEqual(mergeNicheKeywords(null, ['keep me']), ['keep me']);
});

test('classifier catalogue excludes legacy variants and includes reviewed pools before repair', () => {
  const catalogue = nicheCatalogueForPrompt([
    { slug: 'appdev', name: 'App Developers & SaaS', keywords: ['build in public'] },
    { slug: 'fitness-nutrition', name: 'Fitness Nutrition', keywords: ['nutrition'] },
    { slug: 'pet-care', name: 'Pet Care', keywords: ['dog tips'] },
  ]);
  const slugs = new Set(catalogue.map((niche) => niche.slug));
  assert.ok(slugs.has('fitness-weight-loss'));
  assert.ok(slugs.has('fitness-training'));
  assert.ok(slugs.has('pet-care'));
  for (const legacy of LEGACY_NICHE_SLUGS) assert.ok(!slugs.has(legacy));
});

test('an alias choice is mapped to its canonical pool, never recreated', () => {
  const resolved = validateAudienceChoice({
    existing_slug: 'fitness-nutrition',
    new_name: null,
    keywords: ['macro tracking tips', 'calorie tracking', 'nutrition mistakes'],
  }, [{ slug: 'fitness-nutrition', name: 'Fitness Nutrition', keywords: [] }]);
  assert.equal(resolved.slug, 'fitness-weight-loss');
  assert.equal(resolved.name, 'Fitness & Weight Loss');
  assert.equal(resolved.isNew, true);
  assert.equal(resolved.keywords[0], 'calorie deficit tips');
});

test('existing choices use the database canonical name', () => {
  const resolved = validateAudienceChoice({
    existing_slug: 'pet-care',
    new_name: null,
    keywords: ['dog training tips', 'cat care tips', 'new puppy advice'],
  }, [{ slug: 'pet-care', name: 'Pet Care & Training', keywords: ['pet care', 'dog health', 'cat health'] }]);
  assert.deepEqual(resolved, {
    slug: 'pet-care',
    name: 'Pet Care & Training',
    keywords: ['dog training tips', 'cat care tips', 'new puppy advice'],
    isNew: false,
  });
});

test('a genuinely new audience is allowed with server-derived slug and useful searches', () => {
  assert.deepEqual(validateAudienceChoice({
    existing_slug: null,
    new_name: 'Software Development',
    keywords: ['coding tips', 'software engineering', 'developer productivity'],
  }, []), {
    slug: 'software-development',
    name: 'Software Development',
    keywords: ['coding tips', 'software engineering', 'developer productivity'],
    isNew: true,
  });
});

test('invalid, retired, and unknown model choices fail closed', () => {
  assert.throws(
    () => validateAudienceChoice({ existing_slug: 'missing', new_name: null, keywords: [] }, []),
    /unknown pool/i,
  );
  assert.throws(
    () => validateAudienceChoice(
      { existing_slug: 'pet-care', new_name: null, keywords: [] },
      [{ slug: 'pet-care', name: 'Pet Care', keywords: ['pets'] }],
    ),
    /at least three search phrases/i,
  );
  assert.throws(
    () => validateAudienceChoice(
      { existing_slug: null, new_name: 'Pet Care', keywords: [] },
      [{ slug: 'pet-care', name: 'Pet Care', keywords: ['pets'] }],
    ),
    /at least three search phrases/i,
  );
  assert.throws(
    () => validateAudienceChoice({ existing_slug: 'appdev', new_name: null, keywords: [] }, []),
    /retired pool/i,
  );
  assert.throws(
    () => validateAudienceChoice({ existing_slug: null, new_name: 'appdev', keywords: ['a', 'b', 'c'] }, []),
    /retired pool/i,
  );
  assert.throws(
    () => validateAudienceChoice({
      existing_slug: null,
      new_name: 'App Development',
      keywords: ['coding tips', 'developer tools', 'software engineering'],
    }, [{ slug: 'appdev', name: 'App Developers & SaaS' }]),
    /retired pool/i,
  );
  assert.throws(
    () => validateAudienceChoice({ existing_slug: 'pet-care', new_name: 'Pets', keywords: [] }, []),
    /choose one/i,
  );
  assert.throws(
    () => validateAudienceChoice({ existing_slug: null, new_name: null, keywords: [] }, []),
    /choose one/i,
  );
  assert.throws(
    () => validateAudienceChoice({ existing_slug: null, new_name: 'Pets', keywords: ['one'] }, []),
    /at least three/i,
  );
});

test('only an unchanged active v2 audience can skip reclassification', () => {
  const current = {
    app_url: 'https://example.com/app',
    what: 'Tracks calories from meal photos.',
    who: 'People trying to lose weight.',
    benefit: 'Know what you eat.',
    audience_niche: {
      slug: 'fitness-weight-loss',
      name: 'Fitness & Weight Loss',
      classifier_version: NICHE_CLASSIFIER_VERSION,
    },
  };
  const active = [{ slug: 'fitness-weight-loss' }];
  assert.equal(shouldReuseStoredAudience(current, { ...current }, active), true);
  assert.equal(shouldReuseStoredAudience(current, { ...current, benefit: 'Build muscle.' }, active), false);
  assert.equal(shouldReuseStoredAudience(current, { ...current }, []), false);
  assert.equal(shouldReuseStoredAudience({
    ...current,
    audience_niche: { ...current.audience_niche, classifier_version: 1 },
  }, current, active), false);
  assert.equal(shouldReuseStoredAudience({
    ...current,
    audience_niche: {
      slug: 'appdev',
      name: 'App Developers & SaaS',
      classifier_version: NICHE_CLASSIFIER_VERSION,
    },
  }, current, [{ slug: 'appdev' }]), false);
});

test('the launch batch fits the 90-request runner guard', () => {
  assert.ok(LAUNCH_NICHE_SLUGS.length * 9 <= 90);
  assert.ok(!LAUNCH_NICHE_SLUGS.some((slug) => LEGACY_NICHE_SLUGS.includes(slug)));
});
