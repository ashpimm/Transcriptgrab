// api/checkout.js — Create Stripe Checkout sessions (server-side)

import Stripe from 'stripe';
import { getSession } from './_db.js';

export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  const allowed = !origin || (function () { try { return new URL(origin).host === host; } catch { return false; } })();
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getSession(req);
    if (!user) {
      return res.status(401).json({ error: 'Sign in required', auth_required: true });
    }

    const { plan } = req.body || {};
    if (!plan || !['pro', 'single'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan. Use "pro" or "single".' });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const hostHeader = req.headers.host;
    const baseUrl = `${protocol}://${hostHeader}`;

    const sessionParams = {
      client_reference_id: String(user.id),
      customer_email: user.email,
      success_url: `${baseUrl}/api/auth/link-stripe?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/app`,
    };

    if (plan === 'pro') {
      sessionParams.mode = 'subscription';
      sessionParams.line_items = [{
        price: process.env.STRIPE_PRO_PRICE_ID,
        quantity: 1,
      }];
    } else {
      sessionParams.mode = 'payment';
      sessionParams.line_items = [{
        price: process.env.STRIPE_SINGLE_PRICE_ID,
        quantity: 1,
      }];
    }

    // Link to existing Stripe customer if available
    if (user.stripe_customer_id) {
      sessionParams.customer = user.stripe_customer_id;
      delete sessionParams.customer_email;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
