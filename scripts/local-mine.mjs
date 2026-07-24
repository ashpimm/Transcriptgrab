#!/usr/bin/env node

// scripts/local-mine.mjs — Free local transcript mining.
//
// Replaces the Supadata step of the mining pipeline with tools running on
// this machine (home IP): yt-dlp for YouTube auto-captions and metadata, a
// local Whisper build for anything without captions (TikTok, silent-caption
// YouTube videos). Extraction, quality gates, and all database writes stay
// on the server — this script only supplies {url, title, views, followers,
// platform, transcript} candidates to POST /api/mine.
//
// YouTube (candidates discovered server-side, same policy as cron):
//   node scripts/local-mine.mjs --niche=fitness-weight-loss
//   node scripts/local-mine.mjs --niche=fitness-weight-loss --apply --confirm=FRESH_REBUILD
//
// TikTok (candidates discovered locally via yt-dlp; additive by default):
//   node scripts/local-mine.mjs --niche=fitness-weight-loss --tiktok --creator=somehandle --limit=20
//   node scripts/local-mine.mjs --niche=fitness-weight-loss --tiktok --urls-file=tiktoks.txt --apply
//
// Options:
//   --niche=slug           Required. Niche the hooks belong to.
//   --tiktok               TikTok source mode (local discovery, Whisper).
//   --creator=handle       TikTok: mine a creator's recent posts (with --tiktok).
//   --urls=a,b / --urls-file=path
//                          TikTok: explicit video URLs (with --tiktok).
//   --limit=N              TikTok creator mode: how many recent posts (default 20).
//   --mode=fresh|add       fresh = atomically replace the niche's mined hooks,
//                          add = incremental insert. Defaults: youtube=fresh,
//                          tiktok=add (fresh would wipe the niche's YouTube
//                          hooks; requires --allow-fresh with --tiktok).
//   --apply                Write. Without it: dry-run preview, no DB changes.
//   --confirm=FRESH_REBUILD  Required with --apply in fresh mode.
//   --report=path.json     Save full results (secret-free) to a JSON file.
//   --base-url=https://... Override the deployed app URL.
//
// Environment:
//   ADMIN_SECRET   required (same as fresh-mine.mjs)
//   YTDLP_CMD      yt-dlp executable (default: yt-dlp)
//   WHISPER_CMD    Whisper CLI (default: whisper-ctranslate2 — `pip install
//                  whisper-ctranslate2`; any CLI honouring --model/--language/
//                  --output_format/--output_dir works)
//   WHISPER_MODEL  Whisper model name (default: base.en; first run downloads it)
//   WHISPER_DEVICE cpu|cuda (default: cpu — cuda needs NVIDIA CUDA 12 libs)

import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_BASE_URL = 'https://transcriptgrab.vercel.app';
const REQUEST_TIMEOUT_MS = 70_000;
const MIN_TRANSCRIPT_WORDS = 8;
const MIN_CANDIDATE_VIEWS = 250_000; // mirror of api/_youtube.js reach floor
const SPAWN_MAX_BUFFER = 64 * 1024 * 1024;

const YTDLP_CMD = process.env.YTDLP_CMD || 'yt-dlp';
const WHISPER_CMD = process.env.WHISPER_CMD || 'whisper-ctranslate2';
const WHISPER_MODEL = process.env.WHISPER_MODEL || 'base.en';
const WHISPER_DEVICE = process.env.WHISPER_DEVICE || 'cpu';
const WORK_DIR = join(tmpdir(), 'hooklab-local-mine');

// ---------------------------------------------------------------------------
// CLI parsing

function optionValue(args, name) {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export function parseCliOptions(args) {
  const tiktok = args.includes('--tiktok');
  const mode = optionValue(args, '--mode') || (tiktok ? 'add' : 'fresh');
  if (!['fresh', 'add'].includes(mode)) throw new Error(`Unknown --mode=${mode}.`);
  if (tiktok && mode === 'fresh' && !args.includes('--allow-fresh')) {
    throw new Error(
      'fresh mode with --tiktok would replace ALL of the niche\'s mined hooks ' +
      '(including YouTube ones) with this TikTok batch. Use --mode=add, or pass ' +
      '--allow-fresh if that is really what you want.',
    );
  }
  const apply = args.includes('--apply');
  if (apply && mode === 'fresh' && optionValue(args, '--confirm') !== 'FRESH_REBUILD') {
    throw new Error('Applying a fresh rebuild requires --confirm=FRESH_REBUILD.');
  }
  const niche = optionValue(args, '--niche');
  if (!niche) throw new Error('--niche=slug is required.');

  const urlsInline = (optionValue(args, '--urls') || '')
    .split(',').map((u) => u.trim()).filter(Boolean);
  const urlsFile = optionValue(args, '--urls-file');
  const creator = (optionValue(args, '--creator') || '').replace(/^@/, '');
  if (tiktok && !creator && urlsInline.length === 0 && !urlsFile) {
    throw new Error('--tiktok needs --creator=handle, --urls=a,b, or --urls-file=path.');
  }
  if (!tiktok && (creator || urlsInline.length > 0 || urlsFile)) {
    throw new Error('--creator/--urls/--urls-file only apply with --tiktok.');
  }

  const limit = Math.max(1, Math.min(60, Number(optionValue(args, '--limit')) || 20));

  return {
    niche, tiktok, mode, apply,
    creator, urlsInline, urlsFile, limit,
    report: optionValue(args, '--report'),
    baseUrl: (optionValue(args, '--base-url') || process.env.PROMOTE_BASE_URL || DEFAULT_BASE_URL)
      .replace(/\/+$/, ''),
  };
}

// ---------------------------------------------------------------------------
// Caption parsing (pure, tested)

// YouTube "json3" caption payload -> plain text.
export function json3ToText(raw) {
  let data;
  try { data = JSON.parse(raw); } catch { return ''; }
  const events = Array.isArray(data?.events) ? data.events : [];
  // Segments join as-is within an event, but events get a space between them —
  // manually-authored captions often lack trailing whitespace per event, and a
  // fused word ("elephantsthe") would break the server's grounding gate.
  return events
    .map((event) => (Array.isArray(event?.segs) ? event.segs.map((seg) => seg?.utf8 || '').join('') : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// WebVTT -> plain text. YouTube auto-sub VTT repeats each line as the caption
// window rolls, so consecutive duplicates are collapsed.
export function vttToText(raw) {
  const lines = String(raw)
    .split(/\r?\n/)
    .map((line) => line.replace(/<[^>]+>/g, '').trim())
    .filter((line) => line &&
      !/^WEBVTT/.test(line) && !/^NOTE/.test(line) && !/^\d+$/.test(line) &&
      !line.includes('-->') && !/^(Kind|Language):/i.test(line));
  const deduped = [];
  for (const line of lines) {
    if (line !== deduped[deduped.length - 1]) deduped.push(line);
  }
  return deduped.join(' ').replace(/\s+/g, ' ').trim();
}

// Pick the best downloaded caption file for a stem: json3 preferred over vtt.
export function pickCaptionFile(files, stem) {
  const captions = files.filter((f) => f.startsWith(`${stem}.`) && /\.(json3|vtt)$/.test(f));
  return captions.find((f) => f.endsWith('.json3')) || captions.find((f) => f.endsWith('.vtt')) || null;
}

// yt-dlp -J info dump -> POST candidate shape (transcript attached later).
export function candidateFromInfo(info, platform) {
  const url = String(info?.webpage_url || info?.original_url || '').trim();
  const title = String(info?.fulltitle || info?.title || info?.description || '')
    .replace(/\s+/g, ' ').trim().substring(0, 500);
  return {
    url,
    title: title || 'Untitled',
    views: Math.max(0, Math.floor(Number(info?.view_count) || 0)),
    followers: Math.max(0, Math.floor(Number(info?.channel_follower_count) || 0)),
    platform,
  };
}

export function wordCount(text) {
  return (String(text || '').match(/[\p{L}\p{N}]+/gu) || []).length;
}

// ---------------------------------------------------------------------------
// Local tooling (yt-dlp, Whisper)

function runCommand(cmd, args) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: SPAWN_MAX_BUFFER,
    windowsHide: true,
  });
  if (result.error?.code === 'ENOENT') {
    throw new Error(`${cmd} not found on PATH. Install it or set ${cmd === YTDLP_CMD ? 'YTDLP_CMD' : 'WHISPER_CMD'}.`);
  }
  if (result.status !== 0) {
    const stderr = (result.stderr || '').split(/\r?\n/).filter(Boolean).slice(-3).join(' | ');
    throw new Error(`${cmd} exited ${result.status}: ${stderr || 'no stderr'}`);
  }
  return result.stdout;
}

function ytDlpJson(url) {
  return JSON.parse(runCommand(YTDLP_CMD, ['-J', '--no-playlist', '--skip-download', url]));
}

// Download the caption file with yt-dlp itself — it carries the right client
// headers and retry behavior; fetching the raw timedtext URLs ourselves gets
// 429'd by YouTube within a few requests.
function downloadCaptionText(url, stem) {
  mkdirSync(WORK_DIR, { recursive: true });
  try {
    runCommand(YTDLP_CMD, [
      '--skip-download', '--no-playlist',
      '--write-subs', '--write-auto-subs',
      // Exact tracks only — a wildcard like "en.*" also matches every
      // auto-TRANSLATED variant (en-de, en-fr, ...) and the resulting burst of
      // ~50 caption downloads per video gets the IP 429'd immediately.
      '--sub-langs', 'en,en-orig,en-US,en-GB',
      '--sub-format', 'json3/vtt',
      '--retries', '3', '--sleep-requests', '0.5',
      '-o', join(WORK_DIR, `${stem}.%(ext)s`),
      url,
    ]);
    const file = pickCaptionFile(readdirSync(WORK_DIR), stem);
    if (!file) return '';
    const raw = readFileSync(join(WORK_DIR, file), 'utf8');
    return file.endsWith('.json3') ? json3ToText(raw) : vttToText(raw);
  } finally {
    for (const file of readdirSync(WORK_DIR)) {
      if (file.startsWith(`${stem}.`)) rmSync(join(WORK_DIR, file), { force: true });
    }
  }
}

let whisperUnavailable = false;

function whisperTranscribe(url, id) {
  if (whisperUnavailable) throw new Error('Whisper unavailable (earlier failure).');
  mkdirSync(WORK_DIR, { recursive: true });
  const stem = `clip-${id}`;
  try {
    runCommand(YTDLP_CMD, [
      '-f', 'bestaudio/best', '--no-playlist',
      '-o', join(WORK_DIR, `${stem}.%(ext)s`), url,
    ]);
    const audioFile = readdirSync(WORK_DIR).find((f) => f.startsWith(`${stem}.`) && !f.endsWith('.txt'));
    if (!audioFile) throw new Error('audio download produced no file');
    try {
      runCommand(WHISPER_CMD, [
        join(WORK_DIR, audioFile),
        '--language', 'en',
        '--model', WHISPER_MODEL,
        '--device', WHISPER_DEVICE,
        '--output_format', 'txt',
        '--output_dir', WORK_DIR,
      ]);
    } catch (error) {
      if (error.message.includes('not found on PATH')) whisperUnavailable = true;
      throw error;
    }
    const txtFile = readdirSync(WORK_DIR).find((f) => f.startsWith(stem) && f.endsWith('.txt'));
    if (!txtFile) throw new Error('Whisper produced no transcript file');
    return readFileSync(join(WORK_DIR, txtFile), 'utf8').replace(/\s+/g, ' ').trim();
  } finally {
    for (const file of readdirSync(WORK_DIR)) {
      if (file.startsWith(stem)) rmSync(join(WORK_DIR, file), { force: true });
    }
  }
}

// Captions first (free, near-instant), Whisper as fallback. Returns '' on failure.
export async function transcriptFor(candidate, index) {
  const id = `${Date.now().toString(36)}-${index}`;
  try {
    const text = downloadCaptionText(candidate.url, `caps-${id}`);
    if (wordCount(text) >= MIN_TRANSCRIPT_WORDS) {
      console.log('    captions ok');
      return text;
    }
  } catch (error) {
    console.log(`    captions failed: ${error.message}`);
  }
  try {
    const text = whisperTranscribe(candidate.url, id);
    if (wordCount(text) >= MIN_TRANSCRIPT_WORDS) {
      console.log('    whisper ok');
      return text;
    }
    console.log('    whisper transcript too short');
    return '';
  } catch (error) {
    console.log(`    whisper failed: ${error.message}`);
    return '';
  }
}

// ---------------------------------------------------------------------------
// Candidate sources

async function requestJson(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text || `Non-JSON response (${response.status})` };
  }
  return { response, body };
}

async function youtubeCandidates(options, secret) {
  const url = `${options.baseUrl}/api/mine?niche=${encodeURIComponent(options.niche)}&phase=discover`;
  const { response, body } = await requestJson(url, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!response.ok) throw new Error(body?.error || `discover failed (${response.status})`);
  console.log(`Discovered ${body.outlierCount} outliers (scanned ${body.scanned}).`);
  for (const error of body.errors || []) console.log(`  discovery: ${error}`);
  return (body.outliers || []).map((o) => ({
    url: o.url, title: o.title, views: o.views, followers: o.followers, platform: 'youtube',
  }));
}

function tiktokUrlList(options) {
  const urls = [...options.urlsInline];
  if (options.urlsFile) {
    urls.push(...readFileSync(options.urlsFile, 'utf8')
      .split(/\r?\n/).map((u) => u.trim()).filter((u) => u && !u.startsWith('#')));
  }
  if (options.creator) {
    const listing = JSON.parse(runCommand(YTDLP_CMD, [
      '-J', '--flat-playlist', '--playlist-end', String(options.limit),
      `https://www.tiktok.com/@${options.creator}`,
    ]));
    for (const entry of listing?.entries || []) {
      if (entry?.url) urls.push(entry.url);
    }
  }
  return [...new Set(urls)];
}

function tiktokCandidates(options) {
  const urls = tiktokUrlList(options);
  console.log(`${urls.length} TikTok URL(s) to inspect.`);
  const candidates = [];
  for (const [index, url] of urls.entries()) {
    process.stdout.write(`  [${index + 1}/${urls.length}] ${url} ... `);
    try {
      const candidate = candidateFromInfo(ytDlpJson(url), 'tiktok');
      if (candidate.views < MIN_CANDIDATE_VIEWS) {
        console.log(`skipped (${candidate.views} views, below ${MIN_CANDIDATE_VIEWS})`);
        continue;
      }
      console.log(`${candidate.views} views`);
      candidates.push(candidate);
    } catch (error) {
      console.log(`failed: ${error.message}`);
    }
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// Main

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log('See the header of scripts/local-mine.mjs for usage.');
    return;
  }
  const options = parseCliOptions(args);
  const secret = process.env.ADMIN_SECRET;
  if (!secret) throw new Error('ADMIN_SECRET is not set.');

  const fresh = options.mode === 'fresh';
  const dry = !options.apply;
  const maxCandidates = fresh ? 30 : 18;

  const sourced = options.tiktok
    ? tiktokCandidates(options)
    : await youtubeCandidates(options, secret);
  const pool = sourced.slice(0, maxCandidates);
  if (pool.length === 0) throw new Error('No candidates to transcribe.');

  console.log(`Transcribing ${pool.length} candidate(s) locally...`);
  const candidates = [];
  let failures = 0;
  for (const [index, candidate] of pool.entries()) {
    // Gentle pacing between videos keeps YouTube's per-IP throttle away.
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 1500));
    console.log(`  [${index + 1}/${pool.length}] ${candidate.url}`);
    const transcript = await transcriptFor(candidate, index);
    if (transcript) candidates.push({ ...candidate, transcript });
    else failures++;
  }
  console.log(`${candidates.length} transcript(s) ready, ${failures} failed.`);
  if (candidates.length === 0) throw new Error('No transcripts — nothing to submit.');

  console.log(`${dry ? 'Previewing' : 'Applying'} ${options.mode} mine of "${options.niche}"...`);
  const { response, body } = await requestJson(`${options.baseUrl}/api/mine`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      niche: options.niche,
      dry,
      fresh,
      candidates,
    }),
  });

  const summary = {
    niche: options.niche,
    status: response.status,
    mode: options.mode,
    dry,
    submitted: candidates.length,
    transcriptEligible: body?.transcriptEligible ?? null,
    accepted: body?.accepted ?? null,
    inserted: body?.inserted ?? (Array.isArray(body?.wouldInsert) ? body.wouldInsert.length : null),
    refreshed: body?.refreshed ?? null,
    upserted: body?.upserted ?? null,
    canApplyFresh: body?.canApplyFresh ?? null,
    freshBlockers: body?.freshBlockers || [],
    errors: body?.errors || (body?.error ? [body.error] : []),
  };
  console.table([{
    ...summary,
    freshBlockers: summary.freshBlockers.join('; '),
    errors: summary.errors.length,
  }]);
  for (const error of summary.errors) console.log(`  server: ${error}`);

  if (options.report) {
    writeFileSync(options.report, `${JSON.stringify({
      createdAt: new Date().toISOString(),
      options: { ...options, report: undefined },
      summary,
      response: body,
    }, null, 2)}\n`, 'utf8');
    console.log(`Full results saved to ${options.report}`);
  }

  if (!response.ok) {
    process.exitCode = 1;
    throw new Error(body?.error || `mine POST failed (${response.status})`);
  }
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entryPoint) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
