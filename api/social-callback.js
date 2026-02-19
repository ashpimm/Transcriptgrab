// api/social-callback.js — OAuth callbacks for X/Twitter and Facebook

import { getSession, parseCookies, upsertSocialConnection } from './_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { code, state, error } = req.query;

  if (error) {
    return res.writeHead(302, { Location: '/dashboard?social_error=cancelled' }).end();
  }

  if (!code || !state) {
    return res.writeHead(302, { Location: '/dashboard?social_error=missing_params' }).end();
  }

  // Verify session
  const user = await getSession(req);
  if (!user) {
    return res.writeHead(302, { Location: '/dashboard?social_error=auth_required' }).end();
  }

  // Verify CSRF state
  const cookies = parseCookies(req);
  if (!cookies.tg_social_state || cookies.tg_social_state !== state) {
    return res.writeHead(302, { Location: '/dashboard?social_error=invalid_state' }).end();
  }

  // Extract platform from state prefix
  const platform = state.startsWith('twitter_') ? 'twitter' : state.startsWith('facebook_') ? 'facebook' : null;
  if (!platform) {
    return res.writeHead(302, { Location: '/dashboard?social_error=invalid_platform' }).end();
  }

  const clearCookies = [
    'tg_social_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    'tg_pkce_verifier=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
  ];

  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const hostHeader = req.headers.host;
  const baseUrl = `${protocol}://${hostHeader}`;
  const redirectUri = `${baseUrl}/api/social-callback`;

  try {
    if (platform === 'twitter') {
      await handleTwitterCallback(req, res, user, code, redirectUri, cookies, clearCookies);
    } else {
      await handleFacebookCallback(req, res, user, code, redirectUri, clearCookies);
    }
  } catch (err) {
    console.error('Social callback error:', err);
    res.setHeader('Set-Cookie', clearCookies);
    res.writeHead(302, { Location: '/dashboard?social_error=server_error' });
    res.end();
  }
}

async function handleTwitterCallback(req, res, user, code, redirectUri, cookies, clearCookies) {
  const codeVerifier = cookies.tg_pkce_verifier;
  if (!codeVerifier) {
    res.setHeader('Set-Cookie', clearCookies);
    return res.writeHead(302, { Location: '/dashboard?social_error=missing_pkce' }).end();
  }

  // Exchange code for tokens
  const basicAuth = Buffer.from(`${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`).toString('base64');
  const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    console.error('Twitter token exchange failed:', await tokenRes.text());
    res.setHeader('Set-Cookie', clearCookies);
    return res.writeHead(302, { Location: '/dashboard?social_error=token_failed' }).end();
  }

  const tokens = await tokenRes.json();

  // Fetch user profile
  const profileRes = await fetch('https://api.twitter.com/2/users/me', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!profileRes.ok) {
    console.error('Twitter profile fetch failed:', await profileRes.text());
    res.setHeader('Set-Cookie', clearCookies);
    return res.writeHead(302, { Location: '/dashboard?social_error=profile_failed' }).end();
  }

  const profile = await profileRes.json();
  const twitterUser = profile.data;

  // Calculate token expiry
  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;

  await upsertSocialConnection(user.id, 'twitter', {
    platformUserId: twitterUser.id,
    platformUsername: `@${twitterUser.username}`,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || null,
    tokenExpiresAt: expiresAt,
  });

  res.setHeader('Set-Cookie', clearCookies);
  res.writeHead(302, { Location: '/dashboard?connected=twitter' });
  res.end();
}

async function handleFacebookCallback(req, res, user, code, redirectUri, clearCookies) {
  // Exchange code for short-lived token
  const tokenUrl = new URL('https://graph.facebook.com/v19.0/oauth/access_token');
  tokenUrl.searchParams.set('client_id', process.env.FACEBOOK_APP_ID);
  tokenUrl.searchParams.set('client_secret', process.env.FACEBOOK_APP_SECRET);
  tokenUrl.searchParams.set('redirect_uri', redirectUri);
  tokenUrl.searchParams.set('code', code);

  const tokenRes = await fetch(tokenUrl.toString());
  if (!tokenRes.ok) {
    console.error('Facebook token exchange failed:', await tokenRes.text());
    res.setHeader('Set-Cookie', clearCookies);
    return res.writeHead(302, { Location: '/dashboard?social_error=token_failed' }).end();
  }

  const shortToken = await tokenRes.json();

  // Exchange for long-lived token
  const longUrl = new URL('https://graph.facebook.com/v19.0/oauth/access_token');
  longUrl.searchParams.set('grant_type', 'fb_exchange_token');
  longUrl.searchParams.set('client_id', process.env.FACEBOOK_APP_ID);
  longUrl.searchParams.set('client_secret', process.env.FACEBOOK_APP_SECRET);
  longUrl.searchParams.set('fb_exchange_token', shortToken.access_token);

  const longRes = await fetch(longUrl.toString());
  const longToken = longRes.ok ? await longRes.json() : shortToken;

  // Fetch user's pages
  const pagesRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${longToken.access_token}`);
  if (!pagesRes.ok) {
    console.error('Facebook pages fetch failed:', await pagesRes.text());
    res.setHeader('Set-Cookie', clearCookies);
    return res.writeHead(302, { Location: '/dashboard?social_error=no_pages' }).end();
  }

  const pagesData = await pagesRes.json();
  const pages = pagesData.data || [];

  if (pages.length === 0) {
    // User has no pages — store user token instead
    const meRes = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${longToken.access_token}`);
    const me = meRes.ok ? await meRes.json() : { id: 'unknown', name: 'Facebook User' };

    await upsertSocialConnection(user.id, 'facebook', {
      platformUserId: me.id,
      platformUsername: me.name,
      accessToken: longToken.access_token,
      refreshToken: null,
      tokenExpiresAt: longToken.expires_in
        ? new Date(Date.now() + longToken.expires_in * 1000).toISOString()
        : null,
    });
  } else {
    // Use first page's access token (never expires for pages)
    const page = pages[0];
    await upsertSocialConnection(user.id, 'facebook', {
      platformUserId: page.id,
      platformUsername: page.name,
      accessToken: page.access_token,
      refreshToken: null,
      tokenExpiresAt: null, // Page tokens don't expire
    });
  }

  res.setHeader('Set-Cookie', clearCookies);
  res.writeHead(302, { Location: '/dashboard?connected=facebook' });
  res.end();
}
