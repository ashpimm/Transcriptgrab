// api/checkout.js — Stripe Checkout (Pro subscription + credit packs)
// GET  /api/checkout               → Stripe Customer Portal (manage subscription)
// GET  /api/checkout?plan=pro      → Redirect straight into Pro checkout (signed-in)
// GET  /api/checkout?plan=credits  → Redirect straight into credit-pack checkout
// POST /api/checkout {plan}        → Create checkout session, returns { url }

import Stripe from 'stripe';
import { getSession } from './_db.js';

function sessionParams(user, baseUrl, plan) {
  const isCredits = plan === 'credits';
  const params = {
    client_reference_id: String(user.id),
    customer_email: user.email,
    mode: isCredits ? 'payment' : 'subscription',
    line_items: [{
      price: isCredits ? process.env.STRIPE_CREDITS_PRICE_ID : process.env.STRIPE_PRO_PRICE_ID,
      quantity: 1,
    }],
    success_url: `${baseUrl}/api/auth/callback?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/create`,
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

  // ===== GET: checkout redirect OR Customer Portal =====
  if (req.method === 'GET') {
    try {
      const user = await getSession(req);
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const baseUrl = `${protocol}://${req.headers.host}`;

      // ?plan=pro|credits: send straight into checkout (used by landing/feed CTAs)
      const plan = req.query.plan;
      if (plan === 'pro' || plan === 'credits') {
        if (!user) {
          return res.writeHead(302, { Location: `/api/auth/google?plan=${plan}` }).end();
        }
        if (plan === 'pro' && user.tier === 'pro') {
          return res.writeHead(302, { Location: '/create' }).end();
        }
        const session = await stripe.checkout.sessions.create(sessionParams(user, baseUrl, plan));
        return res.writeHead(302, { Location: session.url }).end();
      }

      // Default: customer portal
      if (!user || !user.stripe_customer_id) {
        return res.writeHead(302, { Location: '/account' }).end();
      }
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: user.stripe_customer_id,
        return_url: `${baseUrl}/account`,
      });
      return res.writeHead(302, { Location: portalSession.url }).end();
    } catch (err) {
      console.error('Checkout GET error:', err);
      return res.writeHead(302, { Location: '/account' }).end();
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

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const plan = body && body.plan === 'credits' ? 'credits' : 'pro';

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const baseUrl = `${protocol}://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create(sessionParams(user, baseUrl, plan));

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
