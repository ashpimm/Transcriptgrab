// api/profile.js — App profile CRUD + URL import (scrape + AI structuring).
//
// GET  /api/profile                          -> { profile }
// POST /api/profile {action:'save', profile} -> save reviewed profile
// POST /api/profile {action:'import', url}   -> scrape URL, return AI-prefilled
//                                               profile fields (NOT saved)
// POST /api/profile {action:'refresh_icon'}  -> backfill an older saved profile

import {
  getSession, getProfile, saveProfile, updateProfileIcon, slugifyNiche, ensureNiche,
  getAutoHookPool, getNicheBySlug, getNiches, mergeKeywords, setNicheKeywords,
  claimNicheLightMine, reserveAnonSlot, attachAnonProfile, getAnonProfile,
} from './_db.js';
import { resolveActor, clientIp, hashIp } from './_anon.js';
import { callGemini } from './_shared.js';
import { APP_PROFILE_PROMPT, AUDIENCE_NICHE_PROMPT } from './_prompts.js';
import { mineNiche } from './_miner.js';
import {
  NICHE_CLASSIFIER_VERSION, nicheCatalogueForPrompt,
  shouldReuseStoredAudience, validateAudienceChoice,
} from './_niches.js';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';

export const maxDuration = 60;

const MAX_TEXT_LEN = 3000;
const MAX_URL_LEN = 512;
const FETCH_TIMEOUT_MS = 8000;
const FETCH_MAX_BYTES = 3 * 1024 * 1024; // 3MB — Play Store pages are big
const FETCH_MAX_REDIRECTS = 4;

const BLOCKED_ADDRESSES = new net.BlockList();
[
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
].forEach(([address, prefix]) => BLOCKED_ADDRESSES.addSubnet(address, prefix, 'ipv4'));
[
  ['::', 96],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32],
  ['2001:2::', 48],
  ['2001:10::', 28],
  ['2001:20::', 28],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
].forEach(([address, prefix]) => BLOCKED_ADDRESSES.addSubnet(address, prefix, 'ipv6'));

function corsHeaders(req, res) {
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  const allowed = !origin || (function () {
    try { return new URL(origin).host === host; } catch { return false; }
  })();
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

function clipText(s, n) {
  if (!s || typeof s !== 'string') return '';
  const t = s.trim();
  return t.length > n ? t.slice(0, n) : t;
}

export function isPrivateAddress(address) {
  const clean = String(address || '').replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  const family = net.isIP(clean);
  if (!family) return true;
  if (family === 6 && clean.startsWith('::ffff:')) return true;
  return BLOCKED_ADDRESSES.check(clean, family === 4 ? 'ipv4' : 'ipv6');
}

export function isSafeUrl(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const family = net.isIP(host);
  if (family) return !isPrivateAddress(host);
  if (!host.includes('.')) return false; // blocks localhost and bare intranet hosts
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'home.arpa' ||
    host.endsWith('.home.arpa')
  ) return false;
  return true;
}

async function resolvePublicAddress(hostname, deadline) {
  const clean = hostname.replace(/^\[|\]$/g, '');
  const family = net.isIP(clean);
  if (family) {
    if (isPrivateAddress(clean)) throw new Error('private address blocked');
    return { address: clean, family };
  }

  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('fetch timed out');
  let timer;
  const records = await new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('DNS lookup timed out')), remaining);
    dns.lookup(clean, { all: true, verbatim: true }).then(resolve, reject);
  }).finally(() => clearTimeout(timer));
  if (!records.length || records.some((record) => isPrivateAddress(record.address))) {
    throw new Error('private or unresolved host blocked');
  }
  records.sort((a, b) => a.family - b.family); // IPv4 first when both are public.
  return records[0];
}

function requestHtmlOnce(target, resolved, deadline) {
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(new Error('fetch timed out'));

    const transport = target.protocol === 'https:' ? https : http;
    let settled = false;
    let timer;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const req = transport.request(target, {
      method: 'GET',
      family: resolved.family,
      lookup: (_hostname, _options, callback) =>
        callback(null, resolved.address, resolved.family),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PromoteDevBot/1.0; +https://transcriptgrab.vercel.app)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
      },
    }, (response) => {
      const status = response.statusCode || 0;
      const location = response.headers.location;
      if ([301, 302, 303, 307, 308].includes(status) && location) {
        response.resume();
        try {
          return finish(resolve, { redirect: new URL(location, target).href });
        } catch {
          return finish(reject, new Error('invalid redirect'));
        }
      }
      if (status < 200 || status >= 300) {
        response.resume();
        return finish(reject, new Error('status ' + status));
      }

      const type = String(response.headers['content-type'] || '');
      if (type && !/(?:text\/html|application\/xhtml\+xml)/i.test(type)) {
        response.resume();
        return finish(reject, new Error('response was not HTML'));
      }
      const declared = Number(response.headers['content-length'] || 0);
      if (declared > FETCH_MAX_BYTES) {
        response.resume();
        return finish(reject, new Error('page too large'));
      }

      const chunks = [];
      let total = 0;
      response.on('data', (chunk) => {
        if (settled) return;
        total += chunk.length;
        if (total > FETCH_MAX_BYTES) {
          response.destroy();
          return finish(reject, new Error('page too large'));
        }
        chunks.push(chunk);
      });
      response.on('end', () => finish(resolve, { body: Buffer.concat(chunks, total) }));
      response.on('error', (error) => finish(reject, error));
    });
    req.setTimeout(remaining, () => req.destroy(new Error('fetch timed out')));
    timer = setTimeout(() => req.destroy(new Error('fetch timed out')), remaining);
    req.on('error', (error) => finish(reject, error));
    req.end();
  });
}

async function fetchHtml(url) {
  const deadline = Date.now() + FETCH_TIMEOUT_MS;
  let current = new URL(url);
  for (let redirects = 0; redirects <= FETCH_MAX_REDIRECTS; redirects += 1) {
    if (!isSafeUrl(current.href)) throw new Error('unsafe URL blocked');
    const resolved = await resolvePublicAddress(current.hostname, deadline);
    const result = await requestHtmlOnce(current, resolved, deadline);
    if (result.redirect) {
      if (redirects === FETCH_MAX_REDIRECTS) throw new Error('too many redirects');
      current = new URL(result.redirect);
      continue;
    }
    return {
      html: new TextDecoder('utf-8').decode(result.body),
      finalUrl: current.href,
    };
  }
  throw new Error('too many redirects');
}

function extractMeta(html, attr, name) {
  const re = new RegExp('<meta[^>]+' + attr + '=["\']' + name + '["\'][^>]*content=["\']([^"\']+)["\']', 'i');
  const m = html.match(re);
  if (m) return decodeEntities(m[1]);
  const re2 = new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]*' + attr + '=["\']' + name + '["\']', 'i');
  const m2 = html.match(re2);
  return m2 ? decodeEntities(m2[1]) : '';
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function tagAttribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = tag.match(new RegExp(
    '\\b' + escaped + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))',
    'i',
  ));
  return match ? decodeEntities(match[1] || match[2] || match[3] || '') : '';
}

function publicHttpUrl(raw, baseUrl = undefined) {
  if (!raw || typeof raw !== 'string') return '';
  try {
    const url = new URL(raw.trim(), baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    if (!isSafeUrl(url.href)) return '';
    return url.href;
  } catch {
    return '';
  }
}

function squareAppleArtwork(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    if (host === 'mzstatic.com' || host.endsWith('.mzstatic.com')) {
      url.pathname = url.pathname.replace(
        /\/\d+x\d+[a-z]*\.(png|jpe?g|webp)$/i,
        '/512x512bb.$1',
      );
    }
    return url.href;
  } catch {
    return rawUrl;
  }
}

function imageValue(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = imageValue(item);
      if (found) return found;
    }
    return '';
  }
  if (value && typeof value === 'object') {
    return imageValue(value.url || value.contentUrl || value.src || '');
  }
  return '';
}

function findJsonLdArtwork(node, storesOnly = false) {
  if (!node) return '';
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findJsonLdArtwork(item, storesOnly);
      if (found) return found;
    }
    return '';
  }
  if (typeof node !== 'object') return '';

  const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
  const isAppOrProduct = types.some((type) =>
    /^(?:SoftwareApplication|MobileApplication|WebApplication|Product)$/i.test(String(type || '')),
  );
  const direct = isAppOrProduct
    ? (imageValue(node.image) || imageValue(node.logo))
    : (storesOnly ? '' : imageValue(node.logo));
  if (direct) return direct;

  for (const key of Object.keys(node)) {
    if (node[key] && typeof node[key] === 'object') {
      const found = findJsonLdArtwork(node[key], storesOnly);
      if (found) return found;
    }
  }
  return '';
}

function extractJsonLdArtwork(html, storesOnly = false) {
  const blocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of blocks) {
    const inner = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
    let data;
    try { data = JSON.parse(inner); } catch { continue; }
    const found = findJsonLdArtwork(data, storesOnly);
    if (found) return found;
  }
  return '';
}

function extractLinkedIcons(html) {
  const links = html.match(/<link\b[^>]*>/gi) || [];
  const choices = [];
  for (const link of links) {
    const rel = tagAttribute(link, 'rel').toLowerCase();
    if (!/(?:^|\s)(?:apple-touch-icon(?:-precomposed)?|shortcut\s+icon|icon)(?:\s|$)/.test(rel)) continue;
    const href = tagAttribute(link, 'href');
    if (!href) continue;
    const sizes = tagAttribute(link, 'sizes');
    const size = Math.max(...(sizes.match(/\d+/g) || ['0']).map(Number));
    const priority = rel.includes('apple-touch-icon') ? 3000 : (rel.includes('shortcut') ? 1000 : 2000);
    choices.push({ href, score: priority + Math.min(size, 999) });
  }
  choices.sort((a, b) => b.score - a.score);
  return choices.map((choice) => choice.href);
}

function extractItempropImage(html) {
  const tags = html.match(/<(?:meta|img|link)\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (tagAttribute(tag, 'itemprop').toLowerCase() !== 'image') continue;
    const value = tagAttribute(tag, 'content') || tagAttribute(tag, 'src') || tagAttribute(tag, 'href');
    if (value) return value;
  }
  return '';
}

export function extractProductIcon(html, pageUrl) {
  if (!html || !pageUrl) return '';
  let host = '';
  try { host = new URL(pageUrl).hostname.toLowerCase(); } catch { return ''; }

  const isPlayStore = host === 'play.google.com';
  const isAppStore = host === 'apps.apple.com' || host.endsWith('.apps.apple.com');
  const isStore = isPlayStore || isAppStore;
  const candidates = isStore
    ? [
        extractItempropImage(html),
        extractJsonLdArtwork(html, true),
        extractMeta(html, 'property', 'og:image'),
        extractMeta(html, 'name', 'twitter:image'),
      ]
    : [
        ...extractLinkedIcons(html),
        extractJsonLdArtwork(html),
      ];

  for (const candidate of candidates) {
    const resolved = publicHttpUrl(candidate, pageUrl);
    if (resolved) return isAppStore ? squareAppleArtwork(resolved) : resolved;
  }
  return '';
}

// A real, declared brand accent — never an invented one. Many sites set
// <meta name="theme-color">; store listings don't, and that's fine (we fall
// back to a neutral, not a guess). Gray/near-black/near-white declarations are
// rejected: those are a chrome color, not a brand accent.
function brandColorFromHtml(html) {
  const raw = extractMeta(html, 'name', 'theme-color') || extractMeta(html, 'property', 'theme-color');
  const hex = String(raw || '').trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return '';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  if (sat < 0.15) return ''; // too gray to be a brand accent
  return hex.toUpperCase();
}

function stripHtmlToText(html) {
  // Drop script/style/nav/header/footer blocks (closed pairs)
  let cleaned = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<header\b[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ');
  // Defensive: if an unclosed <script> or <style> remains (truncated page),
  // drop everything from that tag forward so its contents never leak through.
  cleaned = cleaned.replace(/<script\b[\s\S]*$/gi, ' ');
  cleaned = cleaned.replace(/<style\b[\s\S]*$/gi, ' ');
  // Prefer <main> or <article> if present
  const main = cleaned.match(/<(?:main|article)[^>]*>([\s\S]*?)<\/(?:main|article)>/i);
  if (main) cleaned = main[1];
  // Strip remaining tags
  cleaned = cleaned.replace(/<[^>]+>/g, ' ');
  cleaned = decodeEntities(cleaned).replace(/\s+/g, ' ').trim();
  // Final safety: if the result still looks like CSS/JS (braces density, no sentences), reject it
  const braceRatio = (cleaned.match(/[{};]/g) || []).length / Math.max(cleaned.length, 1);
  if (braceRatio > 0.02) return '';
  return cleaned;
}

function extractJsonLdDescription(html) {
  // Play Store + many modern sites embed SoftwareApplication / Product / WebPage JSON-LD.
  const blocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of blocks) {
    const inner = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
    let data;
    try { data = JSON.parse(inner); } catch { continue; }
    const found = findDescriptionInJsonLd(data);
    if (found && found.length >= 40) return found;
  }
  return '';
}

function findDescriptionInJsonLd(node) {
  if (!node) return '';
  if (Array.isArray(node)) {
    for (const item of node) {
      const f = findDescriptionInJsonLd(item);
      if (f) return f;
    }
    return '';
  }
  if (typeof node === 'object') {
    if (typeof node.description === 'string' && node.description.trim().length >= 40) {
      return node.description.trim();
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (v && typeof v === 'object') {
        const f = findDescriptionInJsonLd(v);
        if (f) return f;
      }
    }
  }
  return '';
}

function parseScrapedContent(html, url) {
  const host = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } })();
  const iconUrl = extractProductIcon(html, url);

  // Known hostile targets — bail early with a friendly message.
  const blocked = ['x.com', 'twitter.com', 'instagram.com', 'facebook.com', 'tiktok.com'];
  if (blocked.some(b => host === b || host.endsWith('.' + b))) {
    return { text: '', source: 'blocked', icon_url: '' };
  }

  const isPlayStore = host === 'play.google.com';
  const isAppStore = host === 'apps.apple.com' || host.endsWith('.apps.apple.com');

  const og = extractMeta(html, 'property', 'og:description');
  const metaDesc = extractMeta(html, 'name', 'description');
  const ogTitle = extractMeta(html, 'property', 'og:title');
  const metaTitle = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [, ''])[1].trim();
  const title = ogTitle || metaTitle || '';

  // Play Store + App Store: try multiple extraction strategies, pick longest.
  if (isPlayStore || isAppStore) {
    const candidates = [];

    const ld = extractJsonLdDescription(html);
    if (ld) candidates.push(ld);

    const itemprop = extractMeta(html, 'itemprop', 'description');
    if (itemprop) candidates.push(itemprop);

    if (isPlayStore) {
      // Play Store renders the full description in <div data-g-id="description">...</div>
      const m = html.match(/<div[^>]+data-g-id=["']description["'][^>]*>([\s\S]*?)<\/div>/i);
      if (m) {
        const cleaned = decodeEntities(m[1].replace(/<br\s*\/?>(\s*)/gi, '\n').replace(/<[^>]+>/g, ' '))
          .replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim();
        if (cleaned) candidates.push(cleaned);
      }
    }

    if (isAppStore) {
      // App Store renders description inside <div class="we-truncate">...</div>
      const m = html.match(/<div[^>]+class=["'][^"']*we-truncate[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
      if (m) {
        const cleaned = decodeEntities(m[1].replace(/<br\s*\/?>(\s*)/gi, '\n').replace(/<[^>]+>/g, ' '))
          .replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim();
        if (cleaned) candidates.push(cleaned);
      }
    }

    // Pick the longest candidate that meets a usable threshold.
    candidates.sort((a, b) => b.length - a.length);
    const best = candidates.find(c => c.length >= 80) || '';

    if (best) {
      const combined = title ? (title + ' \u2014 ' + best) : best;
      return { text: clipText(combined, MAX_TEXT_LEN), source: isPlayStore ? 'play_store' : 'app_store', icon_url: iconUrl };
    }

    // Fall back to og/meta for these stores if nothing better worked.
    const desc = og || metaDesc || '';
    if (desc && desc.length >= 40) {
      const combined = [title, desc].filter(Boolean).join(' \u2014 ');
      return { text: clipText(combined, MAX_TEXT_LEN), source: isPlayStore ? 'play_store_short' : 'app_store_short', icon_url: iconUrl };
    }
    // Don't fall through to body stripping for these SPAs — it's noisy.
    return { text: '', source: 'empty', icon_url: iconUrl };
  }

  if (og && og.length >= 40) {
    const combined = title ? (title + ' \u2014 ' + og) : og;
    return { text: clipText(combined, MAX_TEXT_LEN), source: 'og', icon_url: iconUrl };
  }
  if (metaDesc && metaDesc.length >= 40) {
    const combined = title ? (title + ' \u2014 ' + metaDesc) : metaDesc;
    return { text: clipText(combined, MAX_TEXT_LEN), source: 'meta', icon_url: iconUrl };
  }

  // Also try JSON-LD on generic sites (blogs, product pages).
  const ldGeneric = extractJsonLdDescription(html);
  if (ldGeneric) {
    const combined = title ? (title + ' \u2014 ' + ldGeneric) : ldGeneric;
    return { text: clipText(combined, MAX_TEXT_LEN), source: 'jsonld', icon_url: iconUrl };
  }

  // Fallback: strip HTML and take the first chunk of visible text.
  const body = stripHtmlToText(html);
  if (body.length >= 80) {
    const combined = title ? (title + ' \u2014 ' + body) : body;
    return { text: clipText(combined, MAX_TEXT_LEN), source: 'body', icon_url: iconUrl };
  }

  return { text: '', source: 'empty', icon_url: iconUrl };
}

// No tone here on purpose: it is picked fresh on every generation (pickTone in
// _generate.js). A tone pinned once on the profile made 30 autopilot posts a
// month speak in one voice. Old profiles may still carry the key; it is dropped
// on the next save and never read.
function cleanProfile(p) {
  if (!p || typeof p !== 'object') return null;
  return {
    app_url: clipText(p.app_url, MAX_URL_LEN),
    name: clipText(p.name, 100),
    what: clipText(p.what, 1000),
    who: clipText(p.who, 600),
    benefit: clipText(p.benefit, 300),
    icon_url: publicHttpUrl(clipText(p.icon_url, 1000)),
    icon_checked: p.icon_checked === true,
    // Concrete product claims from the store listing/site — the substance
    // slides get written from. Without them the copy model only has three
    // thin sentences and every "value" post collapses into a generic pitch.
    facts: (Array.isArray(p.facts) ? p.facts : [])
      .map((f) => clipText(String(f), 120)).filter(Boolean).slice(0, 8),
    color: /^#[0-9a-fA-F]{6}$/.test(p.color || '') ? p.color.toUpperCase() : '',
    audience_niche: (function () {
      if (!p.audience_niche || typeof p.audience_niche !== 'object') return null;
      const slug = slugifyNiche(String(p.audience_niche.slug || p.audience_niche.name || ''));
      const name = clipText(String(p.audience_niche.name || ''), 100);
      const classifierVersion = Number(p.audience_niche.classifier_version);
      return (slug && name) ? {
        slug,
        name,
        ...(classifierVersion === NICHE_CLASSIFIER_VERSION
          ? { classifier_version: NICHE_CLASSIFIER_VERSION }
          : {}),
      } : null;
    })(),
  };
}

export default async function handler(req, res) {
  corsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Actor = a signed-in user OR (when ANON_IP_SALT is set) a taste-first
  // anonymous visitor identified by the tg_anon cookie. profileGet/profilePut
  // route reads and writes to the right store; anonReserveGate enforces the
  // throttle at the first money-costing step (import or manual save).
  const actor = await resolveActor(req, res, { getSession: (r) => getSession(r).catch(() => null) });
  if (actor.kind === 'none') return res.status(401).json({ error: 'Sign in required.' });
  const user = actor.kind === 'user' ? actor.user : null;
  const anonId = actor.kind === 'anon' ? actor.anonId : null;
  const profileGet = () => (user ? getProfile(user.id) : getAnonProfile(anonId));
  const profilePut = (p) => (user ? saveProfile(user.id, p) : attachAnonProfile(anonId, p));
  async function anonReserveGate() {
    if (user) return true;
    const r = await reserveAnonSlot({ anonId, ipHash: hashIp(clientIp(req)) });
    if (!r.allowed) { res.status(403).json({ error: 'gate', reason: r.reason }); return false; }
    return true;
  }

  if (req.method === 'GET') {
    try {
      const profile = await profileGet();
      return res.status(200).json({ profile });
    } catch (e) {
      console.error('profile get error:', e);
      return res.status(500).json({ error: 'Could not load your profile.' });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const action = (body && body.action) || (req.query && req.query.action) || '';

  // Profiles saved before app icons were supported are upgraded lazily from
  // their existing product URL. The Create page renders immediately with its
  // monogram fallback, then swaps in the icon when this lightweight pass lands.
  if (action === 'refresh_icon') {
    // Legacy icon backfill is an authed-only upgrade; anon imports already
    // carry a fresh icon, so nothing to do.
    if (!user) return res.status(200).json({ ok: true, icon_url: '', icon_checked: false });
    const current = await getProfile(user.id).catch(() => null);
    if (!current?.app_url || current.icon_url || current.icon_checked) {
      return res.status(200).json({
        ok: true,
        icon_url: current?.icon_url || '',
        icon_checked: !!current?.icon_checked,
      });
    }

    if (!isSafeUrl(current.app_url)) {
      const updated = await updateProfileIcon(user.id, current.app_url, '').catch(() => null);
      if (!updated) return res.status(409).json({ error: 'Your product changed while its icon was loading.' });
      return res.status(200).json({ ok: true, icon_url: '', icon_checked: true });
    }

    let page;
    try {
      page = await fetchHtml(current.app_url);
    } catch (e) {
      console.error('profile icon refresh error:', e.message);
      return res.status(502).json({ error: 'Could not check the product icon yet.' });
    }
    const iconUrl = extractProductIcon(page.html, page.finalUrl || current.app_url);

    try {
      const updated = await updateProfileIcon(user.id, current.app_url, iconUrl);
      if (!updated) {
        return res.status(409).json({ error: 'Your product changed while its icon was loading.' });
      }
      return res.status(200).json({ ok: true, icon_url: updated.icon_url || '', icon_checked: true });
    } catch (e) {
      console.error('profile icon refresh save error:', e);
      return res.status(500).json({ error: 'Could not save the product icon.' });
    }
  }

  if (action === 'save') {
    const cleaned = cleanProfile(body.profile);
    if (!cleaned || !cleaned.what) {
      return res.status(400).json({ error: 'Describe what your product helps people do — that field is required.' });
    }
    // Manual-entry anon path reserves here (import reserves earlier and this
    // reuses that slot). A refused throttle returns the sign-in gate.
    if (!(await anonReserveGate())) return;
    // Every profile gets a brand color: it is the accent on every slide, and
    // without one the renderer would have nothing but neutral grays. But the
    // color is the customer's, not ours to invent — the old LLM guess picked
    // random hues (a black+white icon became purple). Use what they set or a
    // real declared color; otherwise a neutral slate, which they can change to
    // their true brand color on the profile after signing in.
    if (!cleaned.color) cleaned.color = '#6D7480';
    // Niche rows are reusable source pools, not hidden client-controlled
    // product labels. Resolve against the active catalogue whenever the
    // product's buyer-defining fields change or an old classifier is present.
    let currentProfile;
    let activeNiches;
    try {
      [currentProfile, activeNiches] = await Promise.all([
        profileGet(),
        getNiches(),
      ]);
    } catch (e) {
      console.error('audience catalogue load failed:', e.message);
      return res.status(500).json({ error: 'Could not load the audience catalogue. Please try again.' });
    }

    let appKw = [];
    let audienceWasResolved = false;
    if (shouldReuseStoredAudience(currentProfile, cleaned, activeNiches)) {
      const storedSlug = currentProfile.audience_niche.slug;
      const row = activeNiches.find((niche) => niche.slug === storedSlug);
      cleaned.audience_niche = {
        slug: row.slug,
        name: row.name,
        classifier_version: NICHE_CLASSIFIER_VERSION,
      };
    } else {
      try {
        const choice = await callGemini(AUDIENCE_NICHE_PROMPT, JSON.stringify({
          product: {
            name: cleaned.name,
            what: cleaned.what,
            who: cleaned.who,
            benefit: cleaned.benefit,
          },
          existing_niches: nicheCatalogueForPrompt(activeNiches),
        }), 0);
        const resolved = validateAudienceChoice(choice, activeNiches);
        appKw = resolved.keywords;
        const row = await ensureNiche({
          slug: resolved.slug,
          name: resolved.name,
          keywords: resolved.keywords,
        });
        audienceWasResolved = true;
        cleaned.audience_niche = {
          slug: row.slug,
          name: row.name,
          classifier_version: NICHE_CLASSIFIER_VERSION,
        };
      } catch (e) {
        console.error('audience niche resolution failed:', e.message);
        return res.status(502).json({
          error: 'Could not place this product in a reliable audience pool. Please try saving again.',
        });
      }
    }

    // Reviewed pool searches stay first. A product may append useful searches
    // into spare slots but can no longer displace the terms every app shares.
    if (appKw.length > 0) {
      try {
        const row = await getNicheBySlug(cleaned.audience_niche.slug);
        if (!row) throw new Error('resolved audience pool is not active');
        const merged = mergeKeywords(row.keywords, appKw);
        if (JSON.stringify(merged) !== JSON.stringify(row.keywords || [])) {
          await setNicheKeywords(cleaned.audience_niche.slug, merged);
        }
      } catch (e) {
        console.error('niche keyword merge failed:', e.message);
        return res.status(500).json({ error: 'Could not prepare this audience pool. Please try again.' });
      }
    }
    // Persist first: the user's edits must never be lost to a light-mine
    // timeout below (mineNiche can eat most of maxDuration on a cold niche).
    try {
      await profilePut(cleaned);
    } catch (e) {
      console.error('profile save error:', e);
      return res.status(500).json({ error: 'Could not save your profile.' });
    }
    // A newly resolved product may land in a new OR pre-seeded-but-empty pool.
    // Give a thin pool one bounded light mine so its first generation is not
    // left without source-backed choices. Unchanged v2 saves skip this work.
    if (audienceWasResolved && cleaned.audience_niche && process.env.YOUTUBE_API_KEY) {
      try {
        // Only cold-start a niche that has essentially nothing. Any real
        // content means the pool is usable now and the daily mine cron keeps it
        // topped up — no need to burn transcript credits on every thin save.
        const pool = await getAutoHookPool(cleaned.audience_niche.slug, 5);
        if (pool.length < 2) {
          const nicheRow = await getNicheBySlug(cleaned.audience_niche.slug);
          if (nicheRow && await claimNicheLightMine(nicheRow.id)) {
            // Hooks are transcript-gated now: maxTranscripts must cover the
            // extractions or a light mine inserts nothing.
            //
            // This mine must NEVER hold the Save response hostage. On a cold
            // niche — or when the transcript provider is throttled — it can run
            // for most of maxDuration, which reads to the user as "Saving…"
            // hanging forever. Its output isn't used in this response (the hook
            // picker fetches the pool separately), so bound it: whatever lands
            // in the window enriches the pool, the rest is abandoned. The 6h
            // claim above prevents a re-mine storm, and curated hooks cover the
            // first post regardless.
            const LIGHT_MINE_BUDGET_MS = 6000;
            await Promise.race([
              mineNiche(nicheRow, process.env.YOUTUBE_API_KEY, {
                maxKeywords: 2, maxSeedChannels: 0, maxExtractions: 4, maxTranscripts: 6,
              }).catch((e) => console.error('light mine run failed:', e.message)),
              new Promise((resolve) => setTimeout(resolve, LIGHT_MINE_BUDGET_MS)),
            ]);
          }
        }
      } catch (e) {
        console.error('light mine on save failed:', e.message);
      }
    }
    return res.status(200).json({ ok: true, profile: cleaned });
  }

  if (action === 'import') {
    const { url } = body || {};
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'Paste a URL first.' });
    // Import is the first money-costing step (scrape + LLM): reserve the anon
    // slot here so bots cannot spam it for free.
    if (!(await anonReserveGate())) return;
    const trimmed = url.trim();
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed;
    if (!isSafeUrl(normalized)) return res.status(400).json({ error: 'That URL isn\u2019t allowed.' });

    try {
      const page = await fetchHtml(normalized);
      const parsed = parseScrapedContent(page.html, page.finalUrl || normalized);
      if (parsed.source === 'blocked' || !parsed.text) {
        return res.status(400).json({ error: 'Couldn\u2019t read that page \u2014 please fill the form manually.' });
      }
      const structured = await callGemini(APP_PROFILE_PROMPT, parsed.text, 0.3);
      const prefill = cleanProfile({
        app_url: normalized,
        name: structured.name,
        what: structured.what,
        who: structured.who,
        benefit: structured.benefit,
        icon_url: parsed.icon_url,
        icon_checked: true,
        facts: structured.facts,
        // Only a real declared color, never the model's vibe-guess (which turned
        // a black/white icon purple). No signal here just means the neutral
        // fallback applies on save; the user can set their true color after.
        color: brandColorFromHtml(page.html),
      });
      return res.status(200).json({ prefill, source: parsed.source });
    } catch (e) {
      console.error('profile import error:', e.message);
      return res.status(400).json({ error: 'Couldn\u2019t import from that URL \u2014 please fill the form manually.' });
    }
  }

  return res.status(400).json({ error: 'Unknown action.' });
}
