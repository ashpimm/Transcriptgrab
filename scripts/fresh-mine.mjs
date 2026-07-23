#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LAUNCH_NICHE_SLUGS, LEGACY_NICHE_SLUGS } from '../api/_niches.js';

const DEFAULT_BASE_URL = 'https://transcriptgrab.vercel.app';
const REQUEST_TIMEOUT_MS = 70_000;
export const MAX_SEARCH_REQUESTS_PER_NICHE = 9;
export const SAFE_SEARCH_REQUEST_BUDGET = 90;

function optionValue(args, name) {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function usage() {
  console.log(`Usage:
  node scripts/fresh-mine.mjs --launch
  node scripts/fresh-mine.mjs --all
  node scripts/fresh-mine.mjs --niches=fitness-weight-loss,productivity-focus
  node scripts/fresh-mine.mjs --launch --apply --confirm=FRESH_REBUILD

Options:
  --launch               Run the ordered, canonical pre-launch batch.
  --all                  Run every active niche after legacy niches are retired.
  --niches=a,b           Run only the listed niche slugs.
  --apply                Apply healthy fresh rebuilds. Without this, dry-run only.
  --confirm=FRESH_REBUILD
                         Required with --apply.
  --allow-over-90-search-requests
                         Override the conservative YouTube search-request guard.
  --report=path.json     Save the full, secret-free results to a JSON file.
  --base-url=https://... Override the deployed app URL.

ADMIN_SECRET must be present in the process environment.`);
}

export function summarize(body, status, apply) {
  const succeeded = status >= 200 && status < 300;
  const keptExisting = apply && status === 409;
  let outcome;
  if (!succeeded && !keptExisting) {
    outcome = 'FAILED';
  } else if (apply) {
    outcome = body?.applied ? 'APPLIED' : keptExisting ? 'KEPT EXISTING' : 'FAILED';
  } else {
    outcome = body?.canApplyFresh ? 'READY' : 'BLOCKED';
  }

  return {
    niche: body?.niche || '',
    status,
    outcome,
    scanned: body?.scanned ?? null,
    outliers: body?.outliers ?? null,
    transcripts: body?.transcriptEligible ?? null,
    transcriptFailures: body?.transcriptFailures ?? null,
    accepted: body?.accepted ?? null,
    before: body?.currentMined ?? null,
    after: body?.finalMined ?? null,
    inserted: Array.isArray(body?.wouldInsert) ? body.wouldInsert.length : null,
    replaced: Array.isArray(body?.wouldReplace) ? body.wouldReplace.length : null,
    upserted: apply ? (body?.upserted ?? null) : null,
    retired: apply
      ? (body?.retired ?? body?.removed ?? null)
      : (Array.isArray(body?.wouldRetire)
        ? body.wouldRetire.length
        : Array.isArray(body?.wouldDelete)
          ? body.wouldDelete.length
          : null),
    blockers: body?.freshBlockers || [],
    errors: body?.errors || (body?.error ? [body.error] : []),
  };
}

export function selectNiches(active, { runAll, runLaunch, requestedSlugs }) {
  if ((runAll || runLaunch)) {
    const legacyActive = active
      .filter((niche) => LEGACY_NICHE_SLUGS.includes(niche.slug))
      .map((niche) => niche.slug)
      .sort();
    if (legacyActive.length > 0) {
      throw new Error(
        `Legacy niches are still active (${legacyActive.join(', ')}). ` +
        'Run the production niche repair before batch mining.',
      );
    }
  }

  if (runAll) {
    return [...active].sort((a, b) => a.slug.localeCompare(b.slug));
  }

  const activeBySlug = new Map(active.map((niche) => [niche.slug, niche]));
  const slugs = runLaunch ? LAUNCH_NICHE_SLUGS : requestedSlugs;
  const missing = slugs.filter((slug) => !activeBySlug.has(slug));
  if (missing.length > 0) {
    throw new Error(`Unknown or inactive niche${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`);
  }
  return slugs.map((slug) => activeBySlug.get(slug));
}

export function enforceSearchRequestBudget(
  nicheCount,
  { allowOverBudget = false, budget = SAFE_SEARCH_REQUEST_BUDGET } = {},
) {
  const maximum = nicheCount * MAX_SEARCH_REQUESTS_PER_NICHE;
  if (maximum > budget && !allowOverBudget) {
    throw new Error(
      `This pass could make up to ${maximum} YouTube search requests, over the ` +
      `${budget}-request safety budget. Narrow the batch or explicitly add ` +
      '--allow-over-90-search-requests after checking today\'s project usage.',
    );
  }
  return maximum;
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

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.includes('-h')) {
    usage();
    return;
  }

  const apply = args.includes('--apply');
  const runAll = args.includes('--all');
  const runLaunch = args.includes('--launch');
  const nicheValue = optionValue(args, '--niches');
  const requestedSlugs = [...new Set((nicheValue || '')
    .split(',')
    .map((slug) => slug.trim())
    .filter(Boolean))];
  const reportPath = optionValue(args, '--report');
  const baseUrl = (optionValue(args, '--base-url') || process.env.PROMOTE_BASE_URL || DEFAULT_BASE_URL)
    .replace(/\/+$/, '');
  const secret = process.env.ADMIN_SECRET;
  const selectedModes = [runAll, runLaunch, requestedSlugs.length > 0].filter(Boolean).length;

  if (selectedModes !== 1) {
    usage();
    throw new Error('Choose exactly one of --launch, --all, or --niches=slug,slug.');
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
  const selected = selectNiches(active, { runAll, runLaunch, requestedSlugs });
  const maximumSearchRequests = enforceSearchRequestBudget(selected.length, {
    allowOverBudget: args.includes('--allow-over-90-search-requests'),
  });

  console.log(`${apply ? 'Applying' : 'Previewing'} ${selected.length} fresh niche rebuild(s), sequentially.`);
  console.log(
    `Worst case: ${maximumSearchRequests} YouTube search requests ` +
    `(${MAX_SEARCH_REQUESTS_PER_NICHE} per niche).`,
  );

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
      const summary = { ...summarize(body, response.status, apply) };
      summary.niche ||= niche.slug;
      results.push({ ...summary, response: body });
      const failureDetail = summary.outcome === 'FAILED' && summary.errors[0]
        ? `; ${summary.errors[0]}`
        : '';
      console.log(
        `${summary.outcome}; accepted ${summary.accepted ?? '?'}; ` +
        `${summary.before ?? '?'} -> ${summary.after ?? '?'} hooks${failureDetail}`,
      );
      if (summary.outcome === 'FAILED') process.exitCode = 1;
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
    http: result.status || '',
    outcome: result.outcome,
    accepted: result.accepted ?? '',
    before: result.before ?? '',
    after: result.after ?? '',
    upserted: result.upserted ?? '',
    retired: result.retired ?? '',
    transcriptFailures: result.transcriptFailures ?? '',
    blockers: result.blockers?.join('; ') || '',
    errors: result.errors?.length || 0,
  })));

  if (reportPath) {
    const report = {
      createdAt: new Date().toISOString(),
      mode: apply ? 'apply' : 'dry',
      baseUrl,
      maximumSearchRequests,
      results,
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`Full results saved to ${reportPath}`);
  }
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entryPoint) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
