// api/social.js — Social account CRUD + OAuth initiation
// GET /api/social — List connected accounts
// GET /api/social?action=connect&platform=twitter|facebook — Initiate OAuth
// DELETE /api/social?id=<id> — Disconnect account

import crypto from 'crypto';
import { getSession, getSocialConnections, deleteSocialConnection, parseCookies } from './_db.js';

export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  const allowed = !origin || (function () { try { return new URL(origin).host === host; } catch { return false; } })();
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth + Pro gate
  const user = await getSession(req);
  if (!user) return res.status(401).json({ error: 'Sign in required' });
  if (user.tier !== 'pro') return res.status(403).json({ error: 'Pro subscription required' });

  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const hostHeader = req.headers.host;
  const baseUrl = `${protocol}://${hostHeader}`;

  // ===== GET: Connect (initiate OAuth) =====
  if (req.method === 'GET' && req.query.action === 'connect') {
    const platform = req.query.platform;
    if (!platform || !['twitter', 'facebook'].includes(platform)) {
      return res.status(400).json({ error: 'Invalid platform. Use "twitter" or "facebook".' });
    }

    const stateRandom = crypto.randomBytes(16).toString('hex');
    const state = `${platform}_${stateRandom}`;
    const cookies = [];

    if (platform === 'twitter') {
      // PKCE — generate code verifier + challenge
      const codeVerifier = crypto.randomBytes(32).toString('base64url');
      const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

      cookies.push(
        `tg_social_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
        `tg_pkce_verifier=${codeVerifier}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
      );

      const params = new URLSearchParams({
        response_type: 'code',
        client_id: process.env.TWITTER_CLIENT_ID,
        redirect_uri: `${baseUrl}/api/social-callback`,
        scope: 'tweet.read tweet.write users.read offline.access',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });

      res.setHeader('Set-Cookie', cookies);
      return res.writeHead(302, { Location: `https://twitter.com/i/oauth2/authorize?${params}` }).end();
    }

    if (platform === 'facebook') {
      cookies.push(
        `tg_social_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
      );

      const params = new URLSearchParams({
        client_id: process.env.FACEBOOK_APP_ID,
        redirect_uri: `${baseUrl}/api/social-callback`,
        scope: 'pages_manage_posts,pages_read_engagement',
        state,
        response_type: 'code',
      });

      res.setHeader('Set-Cookie', cookies);
      return res.writeHead(302, { Location: `https://www.facebook.com/v19.0/dialog/oauth?${params}` }).end();
    }
  }

  // ===== GET: List connections =====
  if (req.method === 'GET') {
    try {
      const connections = await getSocialConnections(user.id);
      return res.status(200).json({ connections });
    } catch (err) {
      console.error('Social list error:', err);
      return res.status(500).json({ error: 'Failed to load connections' });
    }
  }

  // ===== DELETE: Disconnect =====
  if (req.method === 'DELETE') {
    const id = parseInt(req.query.id, 10);
    if (!id) return res.status(400).json({ error: 'Missing id' });

    try {
      const deleted = await deleteSocialConnection(id, user.id);
      if (!deleted) return res.status(404).json({ error: 'Connection not found' });
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('Social disconnect error:', err);
      return res.status(500).json({ error: 'Failed to disconnect' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
