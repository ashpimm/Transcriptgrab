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

test('hook conflicts update copy only inside the same non-curated niche', () => {
  assert.doesNotMatch(upsert, /niche_id\s*=\s*EXCLUDED\.niche_id,/);
  assert.doesNotMatch(upsert, /curated\s*=\s*EXCLUDED\.curated/);
  assert.match(upsert, /WHERE hooks\.niche_id = EXCLUDED\.niche_id/);
  assert.match(upsert, /hooks\.curated = FALSE/);
});

test('fresh replacement is transactional and preserves curated and non-YouTube rows', () => {
  assert.match(replacement, /sql\.transaction/);
  assert.match(replacement, /ownership_complete/);
  assert.match(replacement, /curated = FALSE/);
  assert.match(replacement, /platform = 'youtube'/);
  assert.match(replacement, /UPDATE niches[\s\S]*last_mined_at = NOW\(\)/);
});
