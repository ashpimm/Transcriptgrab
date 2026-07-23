// api/social.js — Social account linking + post queue for the account page.
// GET  /api/social                 -> { enabled, connected, username, posts }
// POST /api/social {action:'link'} -> { url } (hosted upload-post linking page)

import {
  getSession, setUploadPostUsername, getPostsForUser, getPostQueueSummary,
  getLatestAutopilotRuns,
} from './_db.js';
import { uploadPostEnabled, createUploadPostUser, generateLinkUrl, getLinkedPlatforms } from './_uploadpost.js';
import { publicAutopilotHealth } from './_autopilot-health.js';

function cors(req, res) {
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  const allowed = !origin || (function () { try { return new URL(origin).host === host; } catch { return false; } })();
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') { res.status(200).end(); return true; }
  return false;
}

export default async function handler(req, res) {
  if (cors(req, res)) return;

  try {
    const user = await getSession(req).catch(() => null);
    if (!user) return res.status(401).json({ error: 'Sign in required.' });

    if (req.method === 'GET') {
      const [posts, queue, healthRows] = await Promise.all([
        getPostsForUser(user.id),
        getPostQueueSummary(user.id),
        getLatestAutopilotRuns().catch(() => []),
      ]);
      // linked: platform names actually connected at upload-post, null = unknown
      // (lookup failed or response shape unrecognized) — page falls back to a
      // plain "Connected" line rather than claiming platforms it can't verify.
      let linked = null;
      if (user.upload_post_username && uploadPostEnabled()) {
        linked = await getLinkedPlatforms(user.upload_post_username).catch(() => null);
      }
      return res.status(200).json({
        enabled: uploadPostEnabled(),
        connected: !!user.upload_post_username,
        username: user.upload_post_username || '',
        linked,
        posts,
        queue,
        health: publicAutopilotHealth(healthRows),
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

    if (body.action === 'link') {
      if (user.tier !== 'pro') {
        return res.status(402).json({ error: 'Daily Instagram publishing is included with Pro ($19/month). Upgrade to connect your account.', upgrade: true });
      }
      if (!uploadPostEnabled()) {
        return res.status(503).json({ error: 'Instagram connection is temporarily unavailable. Download and publish your post manually for now.' });
      }
      const username = user.upload_post_username || `hooklab-u${user.id}`;
      await createUploadPostUser(username);
      if (!user.upload_post_username) await setUploadPostUsername(user.id, username);
      const url = await generateLinkUrl(username);
      return res.status(200).json({ url });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    console.error('social error:', e);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
