import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { publicAutopilotHealth } from '../api/_autopilot-health.js';

const NOW = Date.parse('2026-07-21T06:00:00Z');

test('recent successful publish and topup runs are healthy', () => {
  const health = publicAutopilotHealth([
    { job: 'publish', status: 'succeeded', trigger: 'recovery', started_at: '2026-07-21T05:00:00Z', finished_at: '2026-07-21T05:01:00Z' },
    { job: 'topup', status: 'succeeded', trigger: 'primary', started_at: '2026-07-21T04:00:00Z', finished_at: '2026-07-21T04:00:10Z' },
  ], NOW);
  assert.equal(health.ok, true);
  assert.equal(health.publish.state, 'healthy');
  assert.equal(health.topup.state, 'healthy');
});

test('failed or stale workers make the health probe actionable', () => {
  const failed = publicAutopilotHealth([
    { job: 'publish', status: 'failed', started_at: '2026-07-21T05:00:00Z', finished_at: '2026-07-21T05:01:00Z' },
    { job: 'topup', status: 'succeeded', started_at: '2026-07-21T04:00:00Z', finished_at: '2026-07-21T04:01:00Z' },
  ], NOW);
  assert.equal(failed.ok, false);
  assert.equal(failed.publish.state, 'attention');

  const stale = publicAutopilotHealth([
    { job: 'publish', status: 'succeeded', started_at: '2026-07-19T00:00:00Z', finished_at: '2026-07-19T00:01:00Z' },
    { job: 'topup', status: 'succeeded', started_at: '2026-07-19T00:00:00Z', finished_at: '2026-07-19T00:01:00Z' },
  ], NOW);
  assert.equal(stale.ok, false);
  assert.equal(stale.publish.state, 'stale');
});

test('an in-progress worker is not declared dead during its grace window', () => {
  const health = publicAutopilotHealth([
    { job: 'publish', status: 'running', started_at: '2026-07-21T05:55:00Z' },
    { job: 'topup', status: 'succeeded', started_at: '2026-07-21T05:00:00Z', finished_at: '2026-07-21T05:01:00Z' },
  ], NOW);
  assert.equal(health.publish.state, 'running');
  assert.equal(health.publish.ok, true);
});

test('Vercel config keeps planning and the four publish slots separate', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const schedules = Object.fromEntries(config.crons.map((cron) => [cron.path, cron.schedule]));
  assert.equal(schedules['/api/autopilot-topup'], '0 17 * * *');
  assert.equal(schedules['/api/autopilot-topup-recovery'], '0 19 * * *');
  // One publish cron per user-selectable posting slot. Each fire also sweeps
  // due + submitted posts, so the old dedicated recovery cron is gone.
  assert.equal(schedules['/api/autopilot'], '30 20 * * *');
  assert.equal(schedules['/api/autopilot-slot-0230'], '30 2 * * *');
  assert.equal(schedules['/api/autopilot-slot-0830'], '30 8 * * *');
  assert.equal(schedules['/api/autopilot-slot-1430'], '30 14 * * *');
  assert.equal(schedules['/api/autopilot-recovery'], undefined);
  assert.equal(config.functions['api/autopilot.js'].maxDuration, 60);
  const rewrites = Object.fromEntries(config.rewrites.map((rewrite) => [rewrite.source, rewrite.destination]));
  assert.match(rewrites['/api/autopilot-topup'], /mode=topup/);
  assert.match(rewrites['/api/autopilot-topup-recovery'], /scheduledTrigger=recovery/);
  for (const slot of ['0230', '0830', '1430']) {
    assert.match(rewrites[`/api/autopilot-slot-${slot}`], /mode=publish/);
    assert.match(rewrites[`/api/autopilot-slot-${slot}`], new RegExp(`scheduledTrigger=slot-${slot}`));
  }
  assert.equal(rewrites['/autopilot'], '/autopilot.html');
});

test('deployment stays within the Vercel Hobby function limit', () => {
  function publicFunctions(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) return publicFunctions(full);
      return entry.name.endsWith('.js') && !entry.name.startsWith('_') ? [full] : [];
    });
  }
  const functions = publicFunctions(new URL('../api/', import.meta.url));
  assert.ok(functions.length <= 12, `found ${functions.length} public functions; Hobby allows 12`);
});

test('signed-in social status includes a user-specific queue summary', () => {
  const source = fs.readFileSync(new URL('../api/social.js', import.meta.url), 'utf8');
  assert.match(source, /getPostQueueSummary\(user\.id\)/);
  assert.match(source, /queue,/);
  // The queue/status surface lives on the Autopilot page now; the account
  // page only links to it.
  const autopilot = fs.readFileSync(new URL('../autopilot.html', import.meta.url), 'utf8');
  assert.match(autopilot, /Next post/);
  assert.match(autopilot, /Nothing will be published while paused/);
  const account = fs.readFileSync(new URL('../account.html', import.meta.url), 'utf8');
  assert.match(account, /href="\/autopilot"/);
});

test('top-up work is bounded to one AI carousel per Hobby invocation', () => {
  const source = fs.readFileSync(new URL('../api/_autopilot-runner.js', import.meta.url), 'utf8');
  assert.match(source, /MAX_TOPUP_POSTS_PER_RUN = 1/);
  assert.match(source, /postsCreatedThisRun >= MAX_TOPUP_POSTS_PER_RUN/);
});

test('autopilot toggle gates both queue generation and publishing', () => {
  const db = fs.readFileSync(new URL('../api/_db.js', import.meta.url), 'utf8');
  // Disabled users never enter topup planning...
  assert.match(db, /profile->>'what' IS NOT NULL\s*\n\s*AND autopilot_enabled/);
  // ...and their due posts are never claimed for publishing (queue holds).
  assert.match(db, /JOIN users u ON u\.id = p\.user_id[\s\S]{0,120}AND u\.autopilot_enabled[\s\S]{0,120}FOR UPDATE OF p SKIP LOCKED/);
  // Columns bootstrap with the rest of the reliability schema.
  assert.match(db, /ADD COLUMN IF NOT EXISTS autopilot_enabled BOOLEAN NOT NULL DEFAULT TRUE/);
  assert.match(db, /ADD COLUMN IF NOT EXISTS post_slot TEXT NOT NULL DEFAULT '20:30'/);
});

test('social endpoint exposes the autopilot control actions', () => {
  const source = fs.readFileSync(new URL('../api/social.js', import.meta.url), 'utf8');
  for (const action of ['toggle', 'set-slot', 'edit-post', 'skip-post']) {
    assert.ok(source.includes(`'${action}'`), `missing action ${action}`);
  }
  // Controls are pro-gated and schema-safe.
  assert.match(source, /ensureAutopilotReliabilitySchema\(\)/);
  assert.match(source, /validatePostEdit/);
  // Queue edits must stay atomic against a concurrent publish claim.
  const db = fs.readFileSync(new URL('../api/_db.js', import.meta.url), 'utf8');
  assert.match(db, /AND status = 'queued'\s*\n\s*RETURNING/);
});

test('top-up respects the per-user posting slot', () => {
  const runner = fs.readFileSync(new URL('../api/_autopilot-runner.js', import.meta.url), 'utf8');
  assert.match(runner, /nextSlots\(.*user\.post_slot\)/);
});

test('misclassified provider-processing rows are eligible for safe verification', () => {
  const source = fs.readFileSync(new URL('../api/_db.js', import.meta.url), 'utf8');
  assert.match(source, /external_ids->>'request_id' IS NOT NULL/);
  assert.match(source, /processing\|pending\|queued/);
});
