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
