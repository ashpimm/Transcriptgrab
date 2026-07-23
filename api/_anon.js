// api/_anon.js — pure helpers for anonymous taste-first generation.
//
// Everything anon is gated on ANON_IP_SALT: when it is unset, anonEnabled()
// is false and every caller falls back to the current signed-in-only flow, so
// production behaviour is byte-identical until the secret is set.
import crypto from 'crypto';

export function anonEnabled() { return !!process.env.ANON_IP_SALT; }

export function anonDailyCap() {
  const n = parseInt(process.env.ANON_DAILY_CAP, 10);
  return Number.isFinite(n) && n > 0 ? n : 75;
}

// Vercel sets x-real-ip to the true client address. x-forwarded-for is
// client-spoofable and deliberately ignored for throttle decisions.
export function clientIp(req) {
  const v = req.headers['x-real-ip'];
  return (Array.isArray(v) ? v[0] : v || '').trim();
}

// Salted so a raw IP is never stored. Empty string when we cannot hash — the
// throttle treats an empty ip_hash as "no IP evidence", never as a match.
export function hashIp(ip) {
  const salt = process.env.ANON_IP_SALT || '';
  if (!salt || !ip) return '';
  return crypto.createHash('sha256').update(salt + '|' + ip).digest('hex');
}

export function evaluateAnonThrottle({ enabled, ipHasComplete, dailyComplete, cap }) {
  if (!enabled) return { allowed: false, reason: 'disabled' };
  if (ipHasComplete) return { allowed: false, reason: 'ip-used' };
  if (dailyComplete >= cap) return { allowed: false, reason: 'daily-cap' };
  return { allowed: true, reason: null };
}

function parseCookies(req) {
  const out = {};
  const header = (req && req.headers && req.headers.cookie) || '';
  header.split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i < 0) return;
    out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

export function parseAnonId(req) {
  const t = parseCookies(req).tg_anon;
  return t && /^[0-9a-f]{64}$/.test(t) ? t : null;
}

export function newAnonToken() { return crypto.randomBytes(32).toString('hex'); }

// Preserve any Set-Cookie already queued (e.g. a session cookie) instead of
// clobbering it — several routes set more than one cookie per response.
export function appendCookie(res, cookieStr) {
  const prev = res.getHeader('Set-Cookie');
  const list = prev ? (Array.isArray(prev) ? prev.slice() : [prev]) : [];
  list.push(cookieStr);
  res.setHeader('Set-Cookie', list);
}

export function setAnonCookie(res, token) {
  appendCookie(res, `tg_anon=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
}

export function clearAnonCookie(res) {
  appendCookie(res, 'tg_anon=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
}

// Identity only — does NOT reserve a throttle slot. Slot reservation happens at
// import-start in the route so only the first money-costing action consumes it.
// getSession is injected to keep this unit testable without a DB.
export async function resolveActor(req, res, { getSession }) {
  const user = await getSession(req);
  if (user) return { kind: 'user', user };
  if (!anonEnabled()) return { kind: 'none', reason: 'disabled' };
  let anonId = parseAnonId(req);
  let minted = false;
  if (!anonId) { anonId = newAnonToken(); minted = true; setAnonCookie(res, anonId); }
  return { kind: 'anon', anonId, minted };
}
