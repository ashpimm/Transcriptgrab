// api/auth/callback.js — Handle Google OAuth return + Stripe link redirect
import Stripe from 'stripe';
import { parseCookies, upsertGoogleUser, createSession, setSessionCookie, getSession, setProStatus, incrementCredits, updateUser, claimCheckoutSession } from '../_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ===== Stripe link-stripe flow (redirected after checkout) =====
  if (req.query.session_id) {
    return handleStripeLink(req, res);
  }

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

  // Clear oauth state + checkout plan cookies on all exits
  const clearCookies = [
    'tg_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    'tg_checkout_plan=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
  ];

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
      res.setHeader('Set-Cookie', clearCookies);
      return res.writeHead(302, { Location: '/app?auth_error=token_failed' }).end();
    }

    const tokens = await tokenRes.json();

    // Fetch user profile
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!profileRes.ok) {
      console.error('Profile fetch failed:', await profileRes.text());
      res.setHeader('Set-Cookie', clearCookies);
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

    // Create session
    const token = await createSession(user.id);

    // Check if user came from a checkout flow (plan=pro)
    const checkoutPlan = cookies.tg_checkout_plan;
    const redirectTo = checkoutPlan === 'pro' ? '/app?checkout=pro' : '/app';

    // Set cookies: clear state/plan + set session
    res.setHeader('Set-Cookie', [
      ...clearCookies,
      `tg_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
    ]);

    res.writeHead(302, { Location: redirectTo });
    res.end();

  } catch (err) {
    console.error('OAuth callback error:', err);
    res.setHeader('Set-Cookie', clearCookies);
    res.writeHead(302, { Location: '/app?auth_error=server_error' });
    res.end();
  }
}

// ===== Stripe link-stripe flow =====
async function handleStripeLink(req, res) {
  const sessionId = req.query.session_id;
  if (!sessionId || !sessionId.startsWith('cs_')) {
    return res.writeHead(302, { Location: '/app?payment=error' }).end();
  }

  try {
    const user = await getSession(req);
    if (!user) {
      return res.writeHead(302, { Location: '/app?payment=auth_required' }).end();
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid') {
      return res.writeHead(302, { Location: '/app?payment=incomplete' }).end();
    }

    if (session.client_reference_id !== String(user.id)) {
      return res.writeHead(302, { Location: '/app?payment=error' }).end();
    }

    const claimed = await claimCheckoutSession(session.id, user.id);
    if (!claimed) {
      return res.writeHead(302, { Location: '/app?payment=success' }).end();
    }

    const customerId = typeof session.customer === 'string'
      ? session.customer
      : session.customer?.id;

    if (session.mode === 'subscription' && session.subscription) {
      const subId = typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription.id;
      await setProStatus(user.id, customerId, subId);
    } else {
      await incrementCredits(user.id);
      if (customerId) {
        await updateUser(user.id, { stripe_customer_id: customerId });
      }
    }

    res.writeHead(302, { Location: '/app?payment=success' });
    res.end();
  } catch (err) {
    console.error('Link Stripe error:', err);
    res.writeHead(302, { Location: '/app?payment=error' });
    res.end();
  }
}
