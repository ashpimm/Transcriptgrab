// api/_uploadpost.js — upload-post.com API client (auto-posting aggregator).
// Feature-flagged on UPLOAD_POST_API_KEY: absent key = manual-export mode,
// every caller must check uploadPostEnabled() first.
// Docs: https://docs.upload-post.com
// Vercel ignores _-prefixed files in api/ as endpoints.

const BASE = 'https://api.upload-post.com/api';

export function uploadPostEnabled() {
  return !!process.env.UPLOAD_POST_API_KEY;
}

async function call(path, { method = 'POST', json, form, extraHeaders = {} } = {}) {
  const headers = { Authorization: `Apikey ${process.env.UPLOAD_POST_API_KEY}`, ...extraHeaders };
  let body;
  if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form; // FormData sets its own content-type boundary
  const r = await fetch(BASE + path, { method, headers, body, signal: AbortSignal.timeout(12000) });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!r.ok) throw new Error(`upload-post ${path} ${r.status}: ${text.substring(0, 300)}`);
  return data;
}

// One upload-post "profile" per Hooklab customer. Idempotent-ish: treat
// "already exists" errors as success.
export async function createUploadPostUser(username) {
  try {
    return await call('/uploadposts/users', { json: { username } });
  } catch (e) {
    if (/exist/i.test(e.message)) return { username, existed: true };
    throw e;
  }
}

// Hosted linking page URL — customer connects their TikTok/Instagram there.
export async function generateLinkUrl(username) {
  const data = await call('/uploadposts/users/generate-jwt', { json: { username } });
  const url = data.access_url || data.url || data.link || '';
  if (!url) throw new Error('upload-post generate-jwt returned no URL: ' + JSON.stringify(data).substring(0, 200));
  return url;
}

// Parse GET /uploadposts/users into the platforms actually linked for one
// profile. Their docs never define the UserProfile schema, so accept the
// plausible shapes; anything unrecognized returns null = "unknown" and the
// caller keeps its requested platforms (publish itself will surface the truth).
export function linkedPlatformsFrom(data, username) {
  const profiles = Array.isArray(data?.profiles) ? data.profiles : null;
  if (!profiles) return null;
  const profile = profiles.find((p) => p && p.username === username);
  if (!profile) return null;
  const accounts = profile.social_accounts ?? profile.socials ?? profile.connected_accounts;
  if (Array.isArray(accounts)) return accounts.filter((a) => typeof a === 'string' && a);
  if (accounts && typeof accounts === 'object') {
    return Object.keys(accounts).filter((k) => {
      const v = accounts[k];
      if (!v) return false;
      if (typeof v === 'object') return Object.keys(v).length > 0;
      return true; // non-empty string or other truthy scalar
    });
  }
  return null;
}

export async function getLinkedPlatforms(username) {
  const data = await call('/uploadposts/users', { method: 'GET' });
  const linked = linkedPlatformsFrom(data, username);
  if (linked === null) {
    console.error('upload-post users list unparsed for', username, ':', JSON.stringify(data).substring(0, 300));
  }
  return linked;
}

// Which platforms a post actually ships to: requested ∩ linked.
// linked === null means we couldn't tell — keep the requested list.
export function effectivePlatforms(requested, linked) {
  if (linked === null) return requested;
  return requested.filter((p) => linked.includes(p));
}

export async function uploadPhotos({ username, photos, title, caption, platforms, requestId }) {
  const form = new FormData();
  form.append('user', username);
  for (const p of platforms) form.append('platform[]', p);
  form.append('title', (title || caption || '').substring(0, 150));
  if (caption) form.append('caption', caption);
  if (caption) form.append('description', caption); // TikTok/others use description
  form.append('async_upload', 'true');
  if (requestId) form.append('request_id', requestId);
  photos.forEach((buf, i) => {
    form.append('photos[]', new Blob([buf], { type: 'image/png' }), `slide-${i + 1}.png`);
  });
  return call('/upload_photos', {
    form,
    extraHeaders: requestId ? { 'Idempotency-Key': requestId, 'X-Request-Id': requestId } : {},
  });
}

export async function getUploadStatus(requestId) {
  return call(`/uploadposts/status?request_id=${encodeURIComponent(requestId)}`, { method: 'GET' });
}

const SUCCESS_STATES = new Set(['completed', 'complete', 'success', 'succeeded', 'publish_success', 'posted']);
const FAILED_STATES = new Set(['failed', 'failure', 'error', 'publish_failed', 'cancelled', 'canceled']);
const PENDING_STATES = new Set(['queued', 'pending', 'processing', 'in_progress', 'retryable', 'submitted', 'running']);

function normalizedStatus(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function resultEntries(results) {
  if (Array.isArray(results)) return results;
  if (results && typeof results === 'object') return Object.entries(results).map(([platform, value]) => ({ platform, ...(value || {}) }));
  return [];
}

function stateFromResults(results) {
  const entries = resultEntries(results);
  if (!entries.length) return null;
  let pending = false;
  const failures = [];
  for (const result of entries) {
    const state = normalizedStatus(result?.status || result?.publish_status);
    const detailState = normalizedStatus(result?.error || result?.message).replace(/[\s-]+/g, '_');
    // Upload-Post can report success:false while a platform is still
    // processing. An explicit terminal status wins, but a pending status or
    // pending detail must never be converted into a permanent failure.
    if (FAILED_STATES.has(state)) {
      failures.push(`${result?.platform || 'platform'}: ${result?.error || result?.message || state || 'failed'}`);
    } else if (PENDING_STATES.has(state) || PENDING_STATES.has(detailState)) {
      pending = true;
    } else if (result?.success === false) {
      failures.push(`${result?.platform || 'platform'}: ${result?.error || result?.message || state || 'failed'}`);
    } else if (result?.success !== true && !SUCCESS_STATES.has(state)) {
      pending = true;
    }
  }
  if (failures.length) return { state: 'failed', message: failures.join('; ') };
  return pending ? { state: 'pending' } : { state: 'succeeded' };
}

// upload-post may return a synchronous per-platform result or an asynchronous
// request id. HTTP 200 alone is not proof that a social post succeeded.
export function uploadResponseState(data) {
  if (!data || data.success === false) {
    return { state: 'failed', message: data?.error || data?.message || 'Upload provider rejected the request.' };
  }
  const resultState = stateFromResults(data.results);
  if (resultState) return resultState;
  if (data.request_id) return { state: 'pending', requestId: data.request_id };
  return { state: 'failed', message: 'Upload provider returned no result or tracking id.' };
}

export function uploadStatusState(data) {
  if (!data) return { state: 'failed', message: 'Upload provider returned an empty status.' };
  const top = normalizedStatus(data.status);
  if (FAILED_STATES.has(top) || data.success === false) {
    return { state: 'failed', message: data.error || data.message || top || 'Upload failed.' };
  }
  const resultState = stateFromResults(data.results);
  if (resultState?.state === 'failed') return resultState;
  if (SUCCESS_STATES.has(top)) return resultState?.state === 'pending' ? resultState : { state: 'succeeded' };
  if (PENDING_STATES.has(top) || resultState?.state === 'pending') return { state: 'pending' };
  if (resultState) return resultState;
  return { state: 'pending' }; // tolerate new provider states; a later run checks again
}
