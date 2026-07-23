import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (name) => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const profile = read('api/profile.js');
const prompts = read('api/_prompts.js');
const db = read('api/_db.js');
const create = read('create.html');
const generate = read('api/_generate.js');
const carousel = read('api/carousel.js');

test('URL import extracts product facts but cannot invent a hidden niche', () => {
  const appPrompt = prompts.slice(
    prompts.indexOf('export const APP_PROFILE_PROMPT'),
    prompts.indexOf('export const AUDIENCE_NICHE_PROMPT'),
  );
  const importHandler = profile.slice(
    profile.indexOf("if (action === 'import')"),
    profile.indexOf("return res.status(400).json({ error: 'Unknown action.'"),
  );
  assert.doesNotMatch(appPrompt, /audience_niche/);
  assert.doesNotMatch(importHandler, /structured\.audience_niche/);
  assert.doesNotMatch(create, /prefillNiche|audience_niche:\s*usesImportedProfile/);
});

test('save-time classification resolves against shared pools and fails closed', () => {
  const saveHandler = profile.slice(
    profile.indexOf("if (action === 'save')"),
    profile.indexOf("if (action === 'import')"),
  );
  assert.match(saveHandler, /shouldReuseStoredAudience\(currentProfile, cleaned, activeNiches\)/);
  assert.match(saveHandler, /existing_niches: nicheCatalogueForPrompt\(activeNiches\)/);
  assert.match(saveHandler, /validateAudienceChoice\(choice, activeNiches\)/);
  assert.match(saveHandler, /\}\), 0\)/);
  assert.match(saveHandler, /return res\.status\(502\)/);
  assert.doesNotMatch(saveHandler, /body\.profile\?\.audience_niche\?\.keywords/);
  assert.doesNotMatch(saveHandler, /ensureNiche\([^;]+\.catch/);
});

test('the classifier prompt prefers reuse and forbids compound feature buckets', () => {
  const audiencePrompt = prompts.slice(
    prompts.indexOf('export const AUDIENCE_NICHE_PROMPT'),
    prompts.indexOf('export const HOOK_PICK_PROMPT'),
  );
  assert.match(audiencePrompt, /existing_slug/);
  assert.match(audiencePrompt, /new_name/);
  assert.match(audiencePrompt, /same creators and searches/i);
  assert.match(audiencePrompt, /Never invent compound feature pools/i);
  assert.doesNotMatch(audiencePrompt, /specialized product in a mega-niche gets its own narrower niche/i);
});

test('daily mining ignores active catalogue rows no saved product uses', () => {
  const stalest = db.slice(
    db.indexOf('export async function getStalestNiches'),
    db.indexOf('export async function getStalestNiche()'),
  );
  assert.match(stalest, /AND EXISTS \([\s\S]*u\.profile->'audience_niche'->>'slug' = n\.slug/);
  assert.match(stalest, /NOT \(n\.slug = ANY\(\$\{LEGACY_NICHE_SLUGS\}\)\)/);
});

test('generation fails closed until a legacy profile has a v2 audience', () => {
  assert.match(generate, /Number\(profile\.audience_niche\?\.classifier_version\) !== NICHE_CLASSIFIER_VERSION/);
  assert.match(generate, /getHooksByIds\(\[hookId\], nicheSlug\)/);
  assert.doesNotMatch(generate, /getCuratedHookPool|falling back to random/);
  assert.match(generate, /hook pick failed closed/);
  assert.match(carousel, /Your product audience needs a quick refresh/);
  assert.match(create, /swipe=1[\s\S]*niche=/);
});

test('thin-pool light mining has an atomic cooldown', () => {
  assert.match(profile, /claimNicheLightMine\(nicheRow\.id\)/);
  const claim = db.slice(
    db.indexOf('export async function claimNicheLightMine'),
    db.indexOf('export { slugifyNiche'),
  );
  assert.match(claim, /last_mined_at < NOW\(\) - INTERVAL '6 hours'/);
  assert.match(claim, /UPDATE niches[\s\S]*RETURNING id/);
});
