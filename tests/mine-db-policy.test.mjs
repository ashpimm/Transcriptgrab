import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../api/_db.js', import.meta.url), 'utf8');
const upsert = source.slice(
  source.indexOf('function upsertHookQuery'),
  source.indexOf('export async function upsertHook'),
);
const replacement = source.slice(
  source.indexOf('export async function replaceMinedHooksForNiche'),
  source.indexOf('export async function getExistingHookUrls'),
);
const reconciliation = source.slice(
  source.indexOf('export async function reconcileNicheCatalogue'),
  source.indexOf('export async function getHooks('),
);
const incremental = source.slice(
  source.indexOf('export async function applyIncrementalMine'),
  source.indexOf('export async function replaceMinedHooksForNiche'),
);

test('hook conflicts update copy only inside the same non-curated niche', () => {
  assert.doesNotMatch(upsert, /niche_id\s*=\s*EXCLUDED\.niche_id,/);
  assert.doesNotMatch(upsert, /curated\s*=\s*EXCLUDED\.curated/);
  assert.match(upsert, /WHERE hooks\.niche_id = EXCLUDED\.niche_id/);
  assert.match(upsert, /hooks\.curated = FALSE/);
});

test('fresh replacement is transactional and soft-retires only obsolete YouTube rows', () => {
  assert.match(replacement, /sql\.transaction/);
  assert.match(replacement, /pg_advisory_xact_lock\(87000, 1\)/);
  assert.match(replacement, /active = TRUE/);
  assert.match(replacement, /ownership_complete/);
  assert.match(replacement, /curated = FALSE/);
  assert.match(replacement, /platform = 'youtube'/);
  assert.match(replacement, /SET platform = 'youtube_retired'/);
  assert.doesNotMatch(replacement, /DELETE FROM hooks/);
  assert.match(replacement, /UPDATE niches[\s\S]*last_mined_at = NOW\(\)/);
});

test('niche repair is transactional, exact-allowlist based, and preserves records', () => {
  assert.match(reconciliation, /sql\.transaction/);
  assert.match(reconciliation, /pg_advisory_xact_lock\(87000, 1\)/);
  assert.match(reconciliation, /Object\.entries\(NICHE_MERGES\)/);
  assert.match(reconciliation, /UPDATE hooks[\s\S]*SET niche_id/);
  assert.match(reconciliation, /UPDATE script_packs[\s\S]*SET niche_id/);
  assert.match(reconciliation, /profile = profile - 'audience_niche'/);
  assert.match(reconciliation, /slug = ANY\(\$\{LEGACY_NICHE_SLUGS\}\)/);
  assert.doesNotMatch(reconciliation, /DELETE FROM (?:niches|hooks|carousels|posts)/);
});

test('incremental writes share the repair lock and reject a niche retired during discovery', () => {
  assert.match(incremental, /sql\.transaction/);
  assert.match(incremental, /pg_advisory_xact_lock\(87000, 1\)/);
  assert.match(incremental, /WHERE id = \$\{nicheId\} AND active = TRUE/);
});

test('repair retires placeholders and product-facing pools are source-backed only', () => {
  assert.match(reconciliation, /SET platform = 'curated_retired'/);
  assert.doesNotMatch(source, /export async function getCuratedHookPool/);
  const hooks = source.slice(
    source.indexOf('export async function getHooks('),
    source.indexOf('export async function getHooksByIds'),
  );
  assert.match(hooks, /h\.curated = FALSE/g);
  assert.match(hooks, /h\.views >= 250000/g);
});

test('manual and saved-hook paths hide inactive, retired, and cross-niche mined rows', () => {
  const byIds = source.slice(
    source.indexOf('export async function getHooksByIds'),
    source.indexOf('function upsertHookQuery'),
  );
  const swipe = source.slice(
    source.indexOf('export async function getSwipeFile'),
    source.indexOf('export async function saveToSwipeFile'),
  );
  const saveSwipe = source.slice(
    source.indexOf('export async function saveToSwipeFile'),
    source.indexOf('export async function removeFromSwipeFile'),
  );
  for (const query of [byIds, swipe, saveSwipe]) {
    assert.match(query, /n\.active = TRUE/);
    assert.match(query, /h\.curated = FALSE/);
    assert.match(query, /h\.platform <> 'youtube_retired'/);
    assert.match(query, /h\.views >= 250000/);
  }
  for (const query of [byIds, swipe]) {
    assert.match(query, /OR n\.slug = \$\{nicheSlug \|\| null\}/);
  }
  const swipeCount = source.slice(
    source.indexOf('export async function swipeFileCount'),
    source.indexOf('// ============================================', source.indexOf('export async function swipeFileCount')),
  );
  assert.match(swipeCount, /JOIN hooks/);
  assert.match(swipeCount, /n\.active = TRUE/);
  assert.match(swipeCount, /h\.platform <> 'youtube_retired'/);
  assert.match(swipeCount, /h\.views >= 250000/);
});
