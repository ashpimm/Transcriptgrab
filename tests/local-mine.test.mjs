import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCliOptions, json3ToText, vttToText, pickCaptionFile, candidateFromInfo, wordCount,
} from '../scripts/local-mine.mjs';
import {
  parseSuppliedCandidates, MAX_SUPPLIED_CANDIDATES, VALID_PLATFORMS,
} from '../api/_miner.js';

// --- parseCliOptions ---------------------------------------------------------

test('cli requires a niche', () => {
  assert.throws(() => parseCliOptions([]), /--niche=slug is required/);
});

test('cli defaults: youtube fresh dry-run', () => {
  const options = parseCliOptions(['--niche=fitness-weight-loss']);
  assert.equal(options.mode, 'fresh');
  assert.equal(options.tiktok, false);
  assert.equal(options.apply, false);
});

test('cli tiktok defaults to add mode and needs a source', () => {
  assert.throws(
    () => parseCliOptions(['--niche=a', '--tiktok']),
    /--creator=handle, --urls=a,b, or --urls-file/,
  );
  const options = parseCliOptions(['--niche=a', '--tiktok', '--creator=@some.handle']);
  assert.equal(options.mode, 'add');
  assert.equal(options.creator, 'some.handle');
});

test('cli blocks tiktok fresh without explicit override', () => {
  assert.throws(
    () => parseCliOptions(['--niche=a', '--tiktok', '--creator=x', '--mode=fresh']),
    /--allow-fresh/,
  );
  const options = parseCliOptions(['--niche=a', '--tiktok', '--creator=x', '--mode=fresh', '--allow-fresh']);
  assert.equal(options.mode, 'fresh');
});

test('cli fresh apply requires confirm', () => {
  assert.throws(
    () => parseCliOptions(['--niche=a', '--apply']),
    /--confirm=FRESH_REBUILD/,
  );
  const options = parseCliOptions(['--niche=a', '--apply', '--confirm=FRESH_REBUILD']);
  assert.equal(options.apply, true);
});

test('cli add apply needs no confirm, tiktok source flags rejected without --tiktok', () => {
  const options = parseCliOptions(['--niche=a', '--mode=add', '--apply']);
  assert.equal(options.apply, true);
  assert.throws(() => parseCliOptions(['--niche=a', '--urls=x']), /only apply with --tiktok/);
});

// --- caption parsing ----------------------------------------------------------

test('json3ToText joins segments and collapses whitespace', () => {
  const raw = JSON.stringify({
    events: [
      { segs: [{ utf8: 'stop ' }, { utf8: 'doing ' }] },
      { tStartMs: 1200 }, // no segs — timing-only event
      { segs: [{ utf8: 'crunches\n' }, { utf8: ' to lose belly fat' }] },
    ],
  });
  assert.equal(json3ToText(raw), 'stop doing crunches to lose belly fat');
});

test('json3ToText returns empty string on garbage', () => {
  assert.equal(json3ToText('not json'), '');
  assert.equal(json3ToText('{}'), '');
});

test('vttToText strips cues, tags, and rolling duplicates', () => {
  const raw = [
    'WEBVTT',
    'Kind: captions',
    'Language: en',
    '',
    '00:00:00.000 --> 00:00:01.500',
    'stop doing <c>crunches</c>',
    '',
    '00:00:01.500 --> 00:00:03.000',
    'stop doing crunches',
    'if you want abs',
    '',
  ].join('\n');
  assert.equal(vttToText(raw), 'stop doing crunches if you want abs');
});

test('pickCaptionFile prefers json3 over vtt and matches only its stem', () => {
  const files = ['caps-a1.en.vtt', 'caps-a1.en.json3', 'caps-a2.en.vtt', 'clip-a1.m4a', 'caps-a1.txt'];
  assert.equal(pickCaptionFile(files, 'caps-a1'), 'caps-a1.en.json3');
  assert.equal(pickCaptionFile(files, 'caps-a2'), 'caps-a2.en.vtt');
  assert.equal(pickCaptionFile(files, 'caps-a3'), null);
});

test('candidateFromInfo maps yt-dlp fields', () => {
  const candidate = candidateFromInfo({
    webpage_url: 'https://www.tiktok.com/@x/video/123',
    fulltitle: '  My   viral   clip  ',
    view_count: 1_234_567.9,
    channel_follower_count: 4200,
  }, 'tiktok');
  assert.deepEqual(candidate, {
    url: 'https://www.tiktok.com/@x/video/123',
    title: 'My viral clip',
    views: 1_234_567,
    followers: 4200,
    platform: 'tiktok',
  });
  const bare = candidateFromInfo({}, 'tiktok');
  assert.equal(bare.title, 'Untitled');
  assert.equal(bare.views, 0);
});

test('wordCount counts unicode words', () => {
  assert.equal(wordCount('stop doing crunches'), 3);
  assert.equal(wordCount(''), 0);
});

// --- parseSuppliedCandidates (server side of the same contract) ---------------

const goodCandidate = (overrides = {}) => ({
  url: 'https://www.youtube.com/watch?v=abc123',
  title: 'Viral short',
  views: 900_000,
  followers: 10_000,
  platform: 'youtube',
  transcript: 'stop doing crunches if you want abs this year',
  ...overrides,
});

test('supplied candidates: accepts valid rows and derives score server-side', () => {
  const { candidates, errors } = parseSuppliedCandidates([goodCandidate()]);
  assert.equal(errors.length, 0);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].platform, 'youtube');
  assert.equal(typeof candidates[0].score, 'number');
});

test('supplied candidates: rejects non-array and oversized payloads', () => {
  assert.equal(parseSuppliedCandidates(undefined).candidates.length, 0);
  assert.equal(parseSuppliedCandidates([]).candidates.length, 0);
  const flood = Array.from({ length: MAX_SUPPLIED_CANDIDATES + 1 }, () => goodCandidate());
  const { candidates, errors } = parseSuppliedCandidates(flood);
  assert.equal(candidates.length, 0);
  assert.match(errors[0], /too many candidates/);
});

test('supplied candidates: rejects bad urls, dupes, and junk fields', () => {
  const { candidates, errors } = parseSuppliedCandidates([
    goodCandidate({ url: 'http://www.youtube.com/watch?v=insecure' }),
    goodCandidate({ url: 'https://evil.example.com/watch?v=abc' }),
    goodCandidate({ url: 'not a url' }),
    goodCandidate(),
    goodCandidate(), // duplicate of the row above
    goodCandidate({ url: 'https://youtu.be/other1', title: '' }),
    goodCandidate({ url: 'https://youtu.be/other2', views: 'many' }),
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(errors.length, 6);
});

test('supplied candidates: enforces the reach floor', () => {
  const { candidates, errors } = parseSuppliedCandidates([
    goodCandidate({ views: 249_999 }),
    goodCandidate({ url: 'https://youtu.be/big', views: 250_000 }),
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].views, 250_000);
  assert.match(errors[0], /below reach threshold/);
});

test('supplied candidates: tiktok platform kept, unknown platform coerced to youtube', () => {
  const { candidates } = parseSuppliedCandidates([
    goodCandidate({ url: 'https://www.tiktok.com/@x/video/1', platform: 'tiktok' }),
    goodCandidate({ url: 'https://www.tiktok.com/@x/video/2', platform: 'myspace' }),
  ]);
  assert.deepEqual(candidates.map((c) => c.platform).sort(), ['tiktok', 'youtube']);
  assert.ok(VALID_PLATFORMS.includes('tiktok'));
});

test('supplied candidates: sorted best reach first', () => {
  const { candidates } = parseSuppliedCandidates([
    goodCandidate({ url: 'https://youtu.be/small', views: 300_000 }),
    goodCandidate({ url: 'https://youtu.be/large', views: 5_000_000 }),
  ]);
  assert.equal(candidates[0].url, 'https://youtu.be/large');
});

test('speechless titles are deprioritized, spoken kept in reach order', async () => {
  const { titleLooksSpoken, prioritizeSpoken } = await import('../scripts/local-mine.mjs');
  assert.equal(titleLooksSpoken('5 meal prep mistakes to stop'), true);
  assert.equal(titleLooksSpoken('Rainy cafe ASMR no talking'), false);
  assert.equal(titleLooksSpoken('Ed Sheeran - Perfect (Lyrics)'), false);
  assert.equal(titleLooksSpoken('Oddly Satisfying slime compilation'), false);
  const ordered = prioritizeSpoken([
    { url: 'a', title: 'ASMR cooking' },
    { url: 'b', title: 'stop doing this in the gym' },
    { url: 'c', title: 'budget tips you need' },
  ]);
  assert.deepEqual(ordered.map((c) => c.url), ['b', 'c', 'a']);
});
