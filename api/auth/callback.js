// api/auth/callback.js — Handle Google OAuth return
import { parseCookies, upsertGoogleUser, createSession, setSessionCookie } from '../_db.js';
import Stripe from 'stripe';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { code, state, error } = req.query;

  if (error) {
    return res.writeHead(302, { Location: '/app?auth_error=cancelled' }).end();
  }

  if (!code || !state) {
    return res.writeHead(302, { Location: '/app?auth_error=missing_params' }).end();
  }

  // Verify state matches cookie
  const cookies = parseCookies(req);
  if (!cookies.tg_oauth_state || cookies.tg_oauth_state !== state) {
    return res.writeHead(302, { Location: '/app?auth_error=invalid_state' }).end();
  }

  // Clear the oauth state cookie
  const clearStateCookie = 'tg_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';

  try {
    const redirectUri = `https://transcriptgrab.vercel.app/api/auth/callback`;

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      console.error('Token exchange failed:', await tokenRes.text());
      res.setHeader('Set-Cookie', clearStateCookie);
      return res.writeHead(302, { Location: '/app?auth_error=token_failed' }).end();
    }

    const tokens = await tokenRes.json();

    // Fetch user profile
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!profileRes.ok) {
      console.error('Profile fetch failed:', await profileRes.text());
      res.setHeader('Set-Cookie', clearStateCookie);
      return res.writeHead(302, { Location: '/app?auth_error=profile_failed' }).end();
    }

    const profile = await profileRes.json();

    // Upsert user in DB
    const user = await upsertGoogleUser({
      googleId: profile.id,
      email: profile.email,
      name: profile.name || '',
      picture: profile.picture || '',
    });

    // Migration: check if this email has an existing Stripe subscription
    if (user.tier !== 'pro' && process.env.STRIPE_SECRET_KEY) {
      try {
        await migrateStripeSubscription(user);
      } catch (e) {
        console.error('Stripe migration check failed:', e.message);
      }
    }

    // Create session
    const token = await createSession(user.id);

    // Set both cookies: clear state + set session
    res.setHeader('Set-Cookie', [
      clearStateCookie,
      `tg_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
    ]);

    res.writeHead(302, { Location: '/app' });
    res.end();

  } catch (err) {
    console.error('OAuth callback error:', err);
    res.setHeader('Set-Cookie', clearStateCookie);
    res.writeHead(302, { Location: '/app?auth_error=server_error' });
    res.end();
  }
}

async function migrateStripeSubscription(user) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const customers = await stripe.customers.list({
    email: user.email.toLowerCase(),
    limit: 5,
  });

  for (const customer of customers.data) {
    const subs = await stripe.subscriptions.list({
      customer: customer.id,
      status: 'active',
      limit: 1,
    });

    if (subs.data.length > 0) {
      const sub = subs.data[0];
      const { getSQL } = await import('../_db.js');
      const sql = getSQL();
      await sql`
        UPDATE users SET
          tier = 'pro',
          stripe_customer_id = ${customer.id},
          stripe_subscription_id = ${sub.id},
          monthly_usage = 0,
          usage_reset_at = date_trunc('month', NOW()) + INTERVAL '1 month',
          updated_at = NOW()
        WHERE id = ${user.id}
      `;
      return;
    }
  }
}
