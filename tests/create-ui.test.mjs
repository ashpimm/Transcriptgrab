import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../create.html', import.meta.url), 'utf8');
const carouselApi = fs.readFileSync(new URL('../api/carousel.js', import.meta.url), 'utf8');

test('Create keeps one generation/render flow active at a time', () => {
  assert.match(source, /if \(ST\.generationBusy\) return;/);
  assert.match(source, /function isCurrentRender\(token, carouselId\)/);
  assert.match(source, /token === ST\.renderToken/);
  assert.match(source, /id="regen-all" disabled/);
  assert.match(source, /id="redo-bg" disabled/);
});

test('Create only enables a complete-post download after every slide renders', () => {
  assert.match(source, /slides\.every\(function \(s\) \{ return !!SLIDE_IMAGES\[s\.index\]; \}\)/);
  assert.match(source, /files\.length !== \(ST\.carousel\.slides \|\| \[\]\)\.length/);
  assert.doesNotMatch(source, /var d2 = el\('dl-all'\); if \(d2\) d2\.disabled = false/);
});

test('a new product import clears metadata from the previous import', () => {
  const start = source.indexOf('function runImport(url)');
  const end = source.indexOf("el('save-profile').addEventListener", start);
  const runImport = source.slice(start, end);
  assert.match(runImport, /ST\.pendingAppUrl = null/);
  assert.match(runImport, /ST\.prefillNiche = null/);
  assert.match(runImport, /ST\.prefillFacts = null/);
  assert.match(runImport, /el\('save-profile'\)\.disabled = true/);
});

test('Create copy does not promise source performance for curated fallback hooks', () => {
  assert.doesNotMatch(source, /opening already outperforming|source-backed opener|5×\+ source-hook standard/);
});

test('downloaded posts include the selected hook source receipt', () => {
  assert.match(carouselApi, /hook:\s*\{[\s\S]*views: Number\(plan\.hook\.views/);
  assert.match(source, /name: 'source\.txt'/);
  assert.match(source, /Source views at research time:/);
});
