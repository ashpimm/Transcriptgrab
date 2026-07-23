// api/_niches.js — Audience-pool policy shared by profile classification,
// production reconciliation, and the manual mining runner.
//
// A niche is a reusable source pool: products belong together when the same
// creators, searches, and hooks serve their users. It is not a product-feature
// taxonomy. Keeping this policy pure makes the high-risk decisions testable
// without a database or an AI call.

export const NICHE_CLASSIFIER_VERSION = 2;

export const CANONICAL_NICHES = Object.freeze([
  {
    slug: 'fitness-weight-loss',
    name: 'Fitness & Weight Loss',
    keywords: ['calorie deficit tips', 'weight loss mistakes', 'macro tracking tips', 'what i eat in a day', 'healthy fat loss'],
  },
  {
    slug: 'fitness-training',
    name: 'Fitness & Training',
    keywords: ['workout tips', 'gym mistakes', 'strength training tips', 'beginner gym advice', 'build muscle tips'],
  },
  {
    slug: 'productivity-focus',
    name: 'Productivity & Focus',
    keywords: ['productivity tips', 'stop procrastinating', 'deep work routine', 'focus tips', 'time management tips'],
  },
  {
    slug: 'meal-planning',
    name: 'Meal Planning',
    keywords: ['easy meal prep', 'healthy meal ideas', 'grocery planning tips', 'high protein meals', 'meal planning for beginners'],
  },
  {
    slug: 'personal-finance',
    name: 'Personal Finance',
    keywords: ['budgeting tips', 'save money tips', 'money mistakes', 'pay off debt', 'personal finance for beginners'],
  },
  {
    slug: 'mental-wellness',
    name: 'Mental Wellness',
    keywords: ['anxiety coping skills', 'self care routine', 'stress relief techniques', 'mental health habits', 'mindfulness tips'],
  },
  {
    slug: 'dating-relationships',
    name: 'Dating & Relationships',
    keywords: ['dating advice', 'relationship red flags', 'first date tips', 'healthy relationship advice', 'dating profile tips'],
  },
  {
    slug: 'language-learning',
    name: 'Language Learning',
    keywords: ['language learning tips', 'learn a language fast', 'language study routine', 'pronunciation tips', 'language learning mistakes'],
  },
  {
    slug: 'travel-planning',
    name: 'Travel Planning',
    keywords: ['travel tips', 'cheap flight tips', 'packing tips', 'travel itinerary tips', 'solo travel tips'],
  },
  {
    slug: 'real-estate-professionals',
    name: 'Real Estate Professionals',
    keywords: ['realtor tips', 'real estate agent marketing', 'realtor lead generation', 'real estate listing tips', 'grow a real estate business'],
  },
  {
    slug: 'coaching-business',
    name: 'Coaching Business',
    keywords: ['online coaching tips', 'grow a coaching business', 'coach client onboarding', 'coaching sales tips', 'coaching content ideas'],
  },
]);

// Exact production rows known to represent the same source audience. Repair
// moves their hooks and references to the destination before deactivation.
export const NICHE_MERGES = Object.freeze({
  fitness: 'fitness-training',
  'fitness-body-sculpting': 'fitness-training',
  'fitness-healthy-eating': 'fitness-weight-loss',
  'fitness-nutrition': 'fitness-weight-loss',
  'fitness-digital-wellness': 'productivity-focus',
  'fitness-productivity': 'productivity-focus',
  'productivity-digital-wellness': 'productivity-focus',
  realtors: 'real-estate-professionals',
  coaches: 'coaching-business',
});

// appdev was the old default, not a trustworthy audience decision. It is
// deliberately not mapped to software-development: genuine developer tools
// can be classified there, while old appdev profiles must be re-evaluated.
export const RETIRED_NICHE_SLUGS = Object.freeze(['appdev']);
export const LEGACY_NICHE_SLUGS = Object.freeze([
  ...Object.keys(NICHE_MERGES),
  ...RETIRED_NICHE_SLUGS,
]);

// One safe pre-launch batch stays below the current 100 search.list
// requests/day ceiling even at the miner's nine-request worst case per niche.
export const LAUNCH_NICHE_SLUGS = Object.freeze([
  'fitness-weight-loss',
  'fitness-training',
  'productivity-focus',
  'meal-planning',
  'personal-finance',
  'mental-wellness',
  'dating-relationships',
  'language-learning',
  'real-estate-professionals',
  'coaching-business',
]);

const EXTRA_ALIASES = Object.freeze({
  'app-development': 'appdev',
  'app-developers-saas': 'appdev',
  'indie-hackers': 'appdev',
  'build-in-public': 'appdev',
  'fitness-and-weight-loss': 'fitness-weight-loss',
  'weight-loss': 'fitness-weight-loss',
  'calorie-counting': 'fitness-weight-loss',
  'fitness-and-nutrition': 'fitness-weight-loss',
  'nutrition-and-weight-loss': 'fitness-weight-loss',
  'fitness-and-training': 'fitness-training',
  'workout-fitness': 'fitness-training',
  'gym-fitness': 'fitness-training',
  'body-sculpting': 'fitness-training',
  productivity: 'productivity-focus',
  'productivity-and-focus': 'productivity-focus',
  'focus-and-productivity': 'productivity-focus',
  'digital-wellness': 'productivity-focus',
  'digital-wellbeing': 'productivity-focus',
  budgeting: 'personal-finance',
  'personal-finance-and-budgeting': 'personal-finance',
  relationships: 'dating-relationships',
  dating: 'dating-relationships',
  'mental-health': 'mental-wellness',
  'meal-prep': 'meal-planning',
  travel: 'travel-planning',
  realtor: 'real-estate-professionals',
  'real-estate': 'real-estate-professionals',
  'real-estate-agents': 'real-estate-professionals',
  coaching: 'coaching-business',
  coaches: 'coaching-business',
});

const CANONICAL_BY_SLUG = new Map(CANONICAL_NICHES.map((niche) => [niche.slug, niche]));
const RETIRED_SET = new Set(RETIRED_NICHE_SLUGS);

export function slugifyNiche(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50)
    .replace(/-+$/, '');
}

export function canonicalNicheSlug(value) {
  const slug = slugifyNiche(value);
  return NICHE_MERGES[slug] || EXTRA_ALIASES[slug] || slug;
}

// Model labels are not stable enough for exact aliases alone. This guard maps
// obvious narrower phrasing back to a shared pool while leaving genuinely
// distinct audiences (for example pregnancy or diabetes) available as dynamic
// pools. The label is the primary signal; keywords help with vague labels.
export function inferCanonicalNicheSlug(label, keywords = []) {
  const name = slugifyNiche(label).replaceAll('-', ' ');
  const terms = cleanNicheKeywords(keywords).join(' ');
  const vagueLabel = /^(health(?: and)? wellness|wellness|healthy living|lifestyle|self improvement|general)$/.test(name);
  const text = vagueLabel ? `${name} ${terms}`.trim() : name;
  if (!text) return '';

  // These audiences can require materially different creators and advice, so
  // they must go through the "new pool" path instead of a broad auto-map.
  if (/\b(pregnan|prenatal|postpartum|diabet|pcos|menopause|senior|elder|child|kids|pediatric)\w*\b/.test(text)) {
    return '';
  }

  if (/\b(productiv|procrastinat|focus|deep work|time management|screen time|digital well(?:ness|being))\w*\b/.test(text)) {
    return 'productivity-focus';
  }
  if (/\b(meal prep|meal planning|recipe|grocery|home cook|healthy meals?)\w*\b/.test(text)) {
    return 'meal-planning';
  }
  if (/\b(weight loss|fat loss|calorie|macro|nutrition|diet|fasting|healthy eating)\w*\b/.test(text)) {
    return 'fitness-weight-loss';
  }
  if (/\b(workout|gym|strength|muscle|body sculpt|fitness)\w*\b/.test(text)) {
    return 'fitness-training';
  }
  if (/\b(personal finance|financial (?:wellness|literacy|health)|finance (?:tips|for beginners)|budget|save money|saving money|money mistakes?|pay off debt|debt free)\w*\b/.test(text)) {
    return 'personal-finance';
  }
  if (/\b(dating|relationship|couples?|marriage)\w*\b/.test(text)) {
    return 'dating-relationships';
  }
  if (/\b(mental health|mental wellness|anxiety|stress relief|mindfulness|meditation|self care)\w*\b/.test(text)) {
    return 'mental-wellness';
  }
  if (/\b(language learning|learn (?:spanish|french|german|italian|japanese|korean)|pronunciation|vocabulary)\w*\b/.test(text)) {
    return 'language-learning';
  }
  if (/\b(travel|trip planning|cheap flights?|packing tips?|itinerary|solo travel)\w*\b/.test(text)) {
    return 'travel-planning';
  }
  if (/\b(realtor|real estate agent|real estate professional|listing agent)\w*\b/.test(text)) {
    return 'real-estate-professionals';
  }
  if (/\b(coaching business|online coach|business coach|coach client|coaching sales)\w*\b/.test(text)) {
    return 'coaching-business';
  }
  return '';
}

export function cleanNicheKeywords(values, limit = 6) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const keyword = String(value || '').trim().toLowerCase().substring(0, 80);
    if (!keyword || seen.has(keyword)) continue;
    seen.add(keyword);
    out.push(keyword);
    if (out.length >= limit) break;
  }
  return out;
}

// Reviewed pool terms stay at the front because the miner only uses the first
// six. Product-specific terms may fill spare slots without displacing policy.
export function mergeNicheKeywords(existing, fresh, cap = 12) {
  const out = [];
  const seen = new Set();
  for (const value of [
    ...(Array.isArray(existing) ? existing : []),
    ...(Array.isArray(fresh) ? fresh : []),
  ]) {
    const keyword = String(value || '').trim();
    const key = keyword.toLowerCase();
    if (!keyword || seen.has(key)) continue;
    seen.add(key);
    out.push(keyword);
    if (out.length >= cap) break;
  }
  return out;
}

export function getCanonicalNiche(slug) {
  return CANONICAL_BY_SLUG.get(canonicalNicheSlug(slug)) || null;
}

export function nicheCatalogueForPrompt(activeNiches) {
  const bySlug = new Map();

  // Include the reviewed catalogue even before production repair has run, so
  // the classifier cannot recreate a legacy variant during the deploy window.
  for (const niche of CANONICAL_NICHES) bySlug.set(niche.slug, niche);

  for (const row of Array.isArray(activeNiches) ? activeNiches : []) {
    const sourceSlug = slugifyNiche(row?.slug);
    const slug = canonicalNicheSlug(sourceSlug);
    if (!slug || RETIRED_SET.has(sourceSlug) || sourceSlug !== slug) continue;
    if (!bySlug.has(slug)) {
      bySlug.set(slug, {
        slug,
        name: String(row?.name || '').trim().substring(0, 100),
        keywords: cleanNicheKeywords(row?.keywords),
      });
    }
  }

  return [...bySlug.values()].map((niche) => ({
    slug: niche.slug,
    name: niche.name,
    keywords: cleanNicheKeywords(niche.keywords),
  }));
}

function normalizedBuyerField(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function shouldReuseStoredAudience(currentProfile, incomingProfile, activeNiches) {
  const stored = currentProfile?.audience_niche;
  if (!stored || Number(stored.classifier_version) !== NICHE_CLASSIFIER_VERSION) return false;

  const storedSlug = slugifyNiche(stored.slug);
  if (!storedSlug || RETIRED_SET.has(storedSlug) || canonicalNicheSlug(storedSlug) !== storedSlug) return false;
  const active = new Set((Array.isArray(activeNiches) ? activeNiches : []).map((row) => slugifyNiche(row?.slug)));
  if (!active.has(storedSlug)) return false;

  return ['app_url', 'what', 'who', 'benefit'].every(
    (field) => normalizedBuyerField(currentProfile?.[field]) === normalizedBuyerField(incomingProfile?.[field]),
  );
}

export function validateAudienceChoice(choice, activeNiches) {
  if (!choice || typeof choice !== 'object' || Array.isArray(choice)) {
    throw new Error('Audience classification returned an invalid object.');
  }

  const existingSlug = slugifyNiche(choice.existing_slug);
  const newName = String(choice.new_name || '').trim().substring(0, 100);
  if (!!existingSlug === !!newName) {
    throw new Error('Audience classification must choose one existing pool or one new pool.');
  }

  const activeBySlug = new Map(
    (Array.isArray(activeNiches) ? activeNiches : [])
      .map((row) => [slugifyNiche(row?.slug), row])
      .filter(([slug]) => slug),
  );
  const keywords = cleanNicheKeywords(choice.keywords);

  if (existingSlug) {
    if (RETIRED_SET.has(existingSlug)) throw new Error('Audience classification selected a retired pool.');
    const slug = inferCanonicalNicheSlug(existingSlug, keywords) || canonicalNicheSlug(existingSlug);
    if (RETIRED_SET.has(slug)) throw new Error('Audience classification selected a retired pool.');
    const row = activeBySlug.get(slug);
    const canonical = CANONICAL_BY_SLUG.get(slug);
    if (!row && !canonical) throw new Error('Audience classification selected an unknown pool.');
    const effectiveKeywords = mergeNicheKeywords(
      Array.isArray(row?.keywords) && row.keywords.length > 0
        ? row.keywords
        : (canonical?.keywords || []),
      keywords,
    );
    if (effectiveKeywords.length < 3) {
      throw new Error('The selected audience pool needs at least three search phrases.');
    }
    return {
      slug,
      name: String(row?.name || canonical.name).trim().substring(0, 100),
      keywords: row && Array.isArray(row.keywords) && row.keywords.length >= 3
        ? keywords
        : effectiveKeywords,
      isNew: !row,
    };
  }

  const rawSlug = slugifyNiche(newName);
  if (!rawSlug) throw new Error('Audience classification returned an empty pool name.');
  if (RETIRED_SET.has(rawSlug)) throw new Error('Audience classification tried to recreate a retired pool.');
  const slug = inferCanonicalNicheSlug(newName, keywords) || canonicalNicheSlug(rawSlug);
  if (RETIRED_SET.has(slug)) throw new Error('Audience classification tried to recreate a retired pool.');
  const row = activeBySlug.get(slug);
  const canonical = CANONICAL_BY_SLUG.get(slug);
  if (row || canonical) {
    const effectiveKeywords = mergeNicheKeywords(
      Array.isArray(row?.keywords) && row.keywords.length > 0
        ? row.keywords
        : (canonical?.keywords || []),
      keywords,
    );
    if (effectiveKeywords.length < 3) {
      throw new Error('The selected audience pool needs at least three search phrases.');
    }
    return {
      slug,
      name: String(row?.name || canonical.name).trim().substring(0, 100),
      keywords: row && Array.isArray(row.keywords) && row.keywords.length >= 3
        ? keywords
        : effectiveKeywords,
      isNew: !row,
    };
  }
  if (newName.length < 3 || keywords.length < 3) {
    throw new Error('A new audience pool needs a clear name and at least three search phrases.');
  }
  return { slug, name: newName, keywords, isNew: true };
}
