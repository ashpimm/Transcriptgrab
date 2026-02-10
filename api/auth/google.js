// api/auth/google.js — Initiate Google OAuth flow
import crypto from 'crypto';

export default function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: 'Google OAuth is not configured' });
  }

  // Generate random state for CSRF protection
  const state = crypto.randomBytes(16).toString('hex');

  // Set state as HttpOnly cookie (10 min TTL)
  const cookies = [`tg_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`];

  // If plan=pro param present, set checkout plan cookie so callback can redirect to checkout
  if (req.query && req.query.plan === 'pro') {
    cookies.push('tg_checkout_plan=pro; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600');
  }

  res.setHeader('Set-Cookie', cookies);

  // Use production domain — Vercel preview URLs won't match Google's allowed redirect URIs
  const redirectUri = `https://transcriptgrab.vercel.app/api/auth/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: state,
    access_type: 'online',
    prompt: 'select_account',
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  res.writeHead(302, { Location: url });
  res.end();
}
