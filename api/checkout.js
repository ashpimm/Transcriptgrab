// api/checkout.js — Stripe Checkout (single Pro tier)
// GET  /api/checkout           → Stripe Customer Portal (manage subscription)
// GET  /api/checkout?plan=pro  → Redirect straight into Pro checkout (signed-in)
// POST /api/checkout           → Create Pro checkout session, returns { url }

import Stripe from 'stripe';
import { getSession } from './_db.js';

function proSessionParams(user, baseUrl) {
  const params = {
    client_reference_id: String(user.id),
    customer_email: user.email,
    mode: 'subscription',
    line_items: [{ price: process.env.STRIPE_PRO_PRICE_ID, quantity: 1 }],
    success_url: `${baseUrl}/api/auth/callback?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/studio`,
  };
  if (user.stripe_customer_id) {
    params.customer = user.stripe_customer_id;
    delete params.customer_email;
  }
  return params;
}

export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  const allowed = !origin || (function () { try { return new URL(origin).host === host; } catch { return false; } })();
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ===== GET: Pro checkout redirect OR Customer Portal =====
  if (req.method === 'GET') {
    try {
      const user = await getSession(req);
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const baseUrl = `${protocol}://${req.headers.host}`;

      // ?plan=pro: send straight into checkout (used by landing/library CTAs)
      if (req.query.plan === 'pro') {
        if (!user) {
          return res.writeHead(302, { Location: '/api/auth/google?plan=pro' }).end();
        }
        if (user.tier === 'pro') {
          return res.writeHead(302, { Location: '/studio' }).end();
        }
        const session = await stripe.checkout.sessions.create(proSessionParams(user, baseUrl));
        return res.writeHead(302, { Location: session.url }).end();
      }

      // Default: customer portal
      if (!user || !user.stripe_customer_id) {
        return res.writeHead(302, { Location: '/library' }).end();
      }
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: user.stripe_customer_id,
        return_url: `${baseUrl}/studio`,
      });
      return res.writeHead(302, { Location: portalSession.url }).end();
    } catch (err) {
      console.error('Checkout GET error:', err);
      return res.writeHead(302, { Location: '/library' }).end();
    }
  }

  // ===== POST: Create checkout session =====
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getSession(req);
    if (!user) {
      return res.status(401).json({ error: 'Sign in required', auth_required: true });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const baseUrl = `${protocol}://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create(proSessionParams(user, baseUrl));

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
