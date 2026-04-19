// api/brand-voice.js — Brand Voice profile + URL scraping (Pro only)

import { getSession, getBrandVoice, saveBrandVoice } from './_db.js';

const MAX_TEXT_LEN = 3000;
const MAX_URL_LEN = 512;
const FETCH_TIMEOUT_MS = 8000;
const FETCH_MAX_BYTES = 3 * 1024 * 1024; // 3MB — Play Store pages are big

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

function isSafeUrl(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (!host.includes('.')) return false; // blocks "localhost", bare hosts
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  // IPv4 literal checks
  if (/^127\./.test(host)) return false;
  if (/^10\./.test(host)) return false;
  if (/^192\.168\./.test(host)) return false;
  if (/^169\.254\./.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false;
  if (host === '0.0.0.0') return false;
  // IPv6 / bracketed
  if (host.includes('[') || host === '::1') return false;
  return true;
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PostMaxxBot/1.0; +https://postmaxx.com/bot)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!r.ok) throw new Error('status ' + r.status);

    const reader = r.body && r.body.getReader ? r.body.getReader() : null;
    if (!reader) return await r.text();

    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > FETCH_MAX_BYTES) { try { reader.cancel(); } catch {} break; }
      chunks.push(value);
    }
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.length; }
    return new TextDecoder('utf-8').decode(buf);
  } finally {
    clearTimeout(timer);
  }
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

  // Known hostile targets — bail early with a friendly message.
  const blocked = ['x.com', 'twitter.com', 'instagram.com', 'facebook.com', 'tiktok.com'];
  if (blocked.some(b => host === b || host.endsWith('.' + b))) {
    return { text: '', source: 'blocked' };
  }

  const isPlayStore = host.includes('play.google.com');
  const isAppStore = host.endsWith('apps.apple.com');

  const og = extractMeta(html, 'property', 'og:description');
  const metaDesc = extractMeta(html, 'name', 'description');
  const ogTitle = extractMeta(html, 'property', 'og:title');
  const metaTitle = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [, ''])[1].trim();
  const title = ogTitle || metaTitle || '';

  // Play Store + App Store: JSON-LD has the full app description, which is far
  // richer (and cleaner) than the short og:description. Prefer that.
  if (isPlayStore || isAppStore) {
    const ld = extractJsonLdDescription(html);
    if (ld) {
      const combined = title ? (title + ' \u2014 ' + ld) : ld;
      return { text: clipText(combined, MAX_TEXT_LEN), source: isPlayStore ? 'play_store' : 'app_store' };
    }
    // Fall back to og/meta for these stores if JSON-LD missing.
    const desc = og || metaDesc || '';
    if (desc && desc.length >= 40) {
      const combined = [title, desc].filter(Boolean).join(' \u2014 ');
      return { text: clipText(combined, MAX_TEXT_LEN), source: isPlayStore ? 'play_store' : 'app_store' };
    }
    // Don't fall through to body stripping for these SPAs — it's noisy.
    return { text: '', source: 'empty' };
  }

  if (og && og.length >= 40) {
    const combined = title ? (title + ' \u2014 ' + og) : og;
    return { text: clipText(combined, MAX_TEXT_LEN), source: 'og' };
  }
  if (metaDesc && metaDesc.length >= 40) {
    const combined = title ? (title + ' \u2014 ' + metaDesc) : metaDesc;
    return { text: clipText(combined, MAX_TEXT_LEN), source: 'meta' };
  }

  // Also try JSON-LD on generic sites (blogs, product pages).
  const ldGeneric = extractJsonLdDescription(html);
  if (ldGeneric) {
    const combined = title ? (title + ' \u2014 ' + ldGeneric) : ldGeneric;
    return { text: clipText(combined, MAX_TEXT_LEN), source: 'jsonld' };
  }

  // Fallback: strip HTML and take the first chunk of visible text.
  const body = stripHtmlToText(html);
  if (body.length >= 80) {
    const combined = title ? (title + ' \u2014 ' + body) : body;
    return { text: clipText(combined, MAX_TEXT_LEN), source: 'body' };
  }

  return { text: '', source: 'empty' };
}

export default async function handler(req, res) {
  corsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await getSession(req).catch(() => null);
  if (!user) return res.status(401).json({ error: 'Sign in required.' });
  if (user.tier !== 'pro') return res.status(403).json({ error: 'Brand Voice is a Pro feature.', upgrade: true });

  const action = (req.query && req.query.action) || '';

  if (req.method === 'GET' && action === 'profile') {
    try {
      const voice = await getBrandVoice(user.id);
      return res.status(200).json({ voice: voice || { product: '', productUrl: '', tone: '', toneUrl: '' } });
    } catch (e) {
      console.error('brand-voice profile error:', e);
      return res.status(500).json({ error: 'Could not load your brand voice.' });
    }
  }

  if (req.method === 'POST' && action === 'save') {
    const { product, productUrl, tone, toneUrl } = req.body || {};
    const cleaned = {
      product: clipText(product, MAX_TEXT_LEN),
      productUrl: clipText(productUrl, MAX_URL_LEN),
      tone: clipText(tone, MAX_TEXT_LEN),
      toneUrl: clipText(toneUrl, MAX_URL_LEN),
    };
    try {
      await saveBrandVoice(user.id, cleaned);
      return res.status(200).json({ ok: true, voice: cleaned });
    } catch (e) {
      console.error('brand-voice save error:', e);
      return res.status(500).json({ error: 'Could not save your brand voice.' });
    }
  }

  if (req.method === 'POST' && action === 'fetch') {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'Paste a URL first.' });
    const trimmed = url.trim();
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed;
    if (!isSafeUrl(normalized)) return res.status(400).json({ error: 'That URL isn\u2019t allowed.' });

    try {
      const html = await fetchHtml(normalized);
      const parsed = parseScrapedContent(html, normalized);
      if (parsed.source === 'blocked') {
        return res.status(400).json({ error: 'This site blocks automated reading \u2014 please paste the text manually.' });
      }
      if (!parsed.text) {
        return res.status(400).json({ error: 'Couldn\u2019t read that page \u2014 please paste the text manually.' });
      }
      return res.status(200).json({ text: parsed.text, source: parsed.source });
    } catch (e) {
      console.error('brand-voice fetch error:', e.message);
      return res.status(400).json({ error: 'Couldn\u2019t fetch that URL \u2014 please paste the text manually.' });
    }
  }

  return res.status(400).json({ error: 'Unknown action.' });
}
