// api/_uploadpost.js — upload-post.com API client (auto-posting aggregator).
// Feature-flagged on UPLOAD_POST_API_KEY: absent key = manual-export mode,
// every caller must check uploadPostEnabled() first.
// Docs: https://docs.upload-post.com
// Vercel ignores _-prefixed files in api/ as endpoints.

const BASE = 'https://api.upload-post.com/api';

export function uploadPostEnabled() {
  return !!process.env.UPLOAD_POST_API_KEY;
}

async function call(path, { method = 'POST', json, form } = {}) {
  const headers = { Authorization: `Apikey ${process.env.UPLOAD_POST_API_KEY}` };
  let body;
  if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form; // FormData sets its own content-type boundary
  const r = await fetch(BASE + path, { method, headers, body });
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

export async function uploadPhotos({ username, photos, title, caption, platforms }) {
  const form = new FormData();
  form.append('user', username);
  for (const p of platforms) form.append('platform[]', p);
  form.append('title', (title || caption || '').substring(0, 150));
  if (caption) form.append('caption', caption);
  if (caption) form.append('description', caption); // TikTok/others use description
  photos.forEach((buf, i) => {
    form.append('photos[]', new Blob([buf], { type: 'image/png' }), `slide-${i + 1}.png`);
  });
  return call('/upload_photos', { form });
}
