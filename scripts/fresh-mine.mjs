#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';

const DEFAULT_BASE_URL = 'https://transcriptgrab.vercel.app';
const REQUEST_TIMEOUT_MS = 70_000;

function optionValue(args, name) {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function usage() {
  console.log(`Usage:
  node scripts/fresh-mine.mjs --all
  node scripts/fresh-mine.mjs --niches=fitness-weight-loss,fitness-nutrition
  node scripts/fresh-mine.mjs --all --apply --confirm=FRESH_REBUILD

Options:
  --all                  Run every active niche.
  --niches=a,b           Run only the listed niche slugs.
  --apply                Apply healthy fresh rebuilds. Without this, dry-run only.
  --confirm=FRESH_REBUILD
                         Required with --apply.
  --report=path.json     Save the full, secret-free results to a JSON file.
  --base-url=https://... Override the deployed app URL.

ADMIN_SECRET must be present in the process environment.`);
}

function summarize(body, status, apply) {
  return {
    niche: body?.niche || '',
    status,
    outcome: apply
      ? (body?.applied ? 'APPLIED' : status === 409 ? 'KEPT EXISTING' : 'FAILED')
      : (body?.canApplyFresh ? 'READY' : 'BLOCKED'),
    scanned: body?.scanned ?? null,
    outliers: body?.outliers ?? null,
    transcripts: body?.transcriptEligible ?? null,
    accepted: body?.accepted ?? null,
    before: body?.currentMined ?? null,
    after: body?.finalMined ?? null,
    inserted: Array.isArray(body?.wouldInsert) ? body.wouldInsert.length : null,
    replaced: Array.isArray(body?.wouldReplace) ? body.wouldReplace.length : null,
    removed: apply ? (body?.removed ?? null) : (Array.isArray(body?.wouldDelete) ? body.wouldDelete.length : null),
    blockers: body?.freshBlockers || [],
    errors: body?.errors || (body?.error ? [body.error] : []),
  };
}

async function requestJson(url, headers = {}) {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text || `Non-JSON response (${response.status})` };
  }
  return { response, body };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    usage();
    return;
  }

  const apply = args.includes('--apply');
  const runAll = args.includes('--all');
  const nicheValue = optionValue(args, '--niches');
  const requestedSlugs = (nicheValue || '')
    .split(',')
    .map((slug) => slug.trim())
    .filter(Boolean);
  const reportPath = optionValue(args, '--report');
  const baseUrl = (optionValue(args, '--base-url') || process.env.PROMOTE_BASE_URL || DEFAULT_BASE_URL)
    .replace(/\/+$/, '');
  const secret = process.env.ADMIN_SECRET;

  if (!runAll && requestedSlugs.length === 0) {
    usage();
    throw new Error('Choose --all or --niches=slug,slug.');
  }
  if (!secret) throw new Error('ADMIN_SECRET is not set.');
  if (apply && optionValue(args, '--confirm') !== 'FRESH_REBUILD') {
    throw new Error('Applying requires --confirm=FRESH_REBUILD.');
  }

  const catalogue = await requestJson(`${baseUrl}/api/hooks`);
  if (!catalogue.response.ok || !Array.isArray(catalogue.body?.niches)) {
    throw new Error(catalogue.body?.error || `Could not list niches (${catalogue.response.status}).`);
  }

  const active = catalogue.body.niches;
  const selected = runAll
    ? active
    : requestedSlugs.map((slug) => {
      const niche = active.find((candidate) => candidate.slug === slug);
      if (!niche) throw new Error(`Unknown or inactive niche: ${slug}`);
      return niche;
    });

  console.log(`${apply ? 'Applying' : 'Previewing'} ${selected.length} fresh niche rebuild(s), sequentially.`);
  console.log(`At most ${selected.length * 600} YouTube search quota units for this pass.`);

  const authorization = { Authorization: `Bearer ${secret}` };
  const results = [];
  for (let index = 0; index < selected.length; index++) {
    const niche = selected[index];
    const params = new URLSearchParams({ niche: niche.slug, fresh: '1' });
    if (!apply) params.set('dry', '1');
    const url = `${baseUrl}/api/mine?${params}`;

    process.stdout.write(`[${index + 1}/${selected.length}] ${niche.slug} ... `);
    try {
      const { response, body } = await requestJson(url, authorization);
      const summary = summarize(body, response.status, apply);
      results.push({ ...summary, response: body });
      console.log(
        `${summary.outcome}; accepted ${summary.accepted ?? '?'}; ` +
        `${summary.before ?? '?'} -> ${summary.after ?? '?'} hooks`,
      );
      if (!response.ok && response.status !== 409) process.exitCode = 1;
    } catch (error) {
      const summary = {
        niche: niche.slug,
        status: 0,
        outcome: 'FAILED',
        errors: [error.message],
      };
      results.push({ ...summary, response: null });
      console.log(`FAILED; ${error.message}`);
      process.exitCode = 1;
    }
  }

  console.table(results.map(({ response: _response, ...result }) => ({
    niche: result.niche,
    outcome: result.outcome,
    accepted: result.accepted ?? '',
    before: result.before ?? '',
    after: result.after ?? '',
    blockers: result.blockers?.join('; ') || '',
    errors: result.errors?.length || 0,
  })));

  if (reportPath) {
    const report = {
      createdAt: new Date().toISOString(),
      mode: apply ? 'apply' : 'dry',
      baseUrl,
      results,
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`Full results saved to ${reportPath}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
