// api/checkout.js — Stripe Checkout sessions + anonymous single-video checkout
// GET  /api/checkout              → Stripe Customer Portal (manage subscription)
// POST /api/checkout              → Create checkout session (pro or single, signed-in)
// GET  /api/checkout-single       → Start anonymous $5 checkout (rewritten here via vercel.json)
// GET  /api/checkout-single?session_id=... → Verify anonymous payment + set credit cookie

import Stripe from 'stripe';
import { getSession, createSingleCredit, setCreditCookie } from './_db.js';

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

  // ===== ANONYMOUS SINGLE-VIDEO FLOW =====
  // Detected by ?flow=single param (start) or ?session_id param (verify)
  if (req.method === 'GET' && (req.query.flow === 'single' || req.query.session_id)) {
    return handleSingleCredit(req, res);
  }

  // ===== GET: Stripe Customer Portal (manage subscription) =====
  if (req.method === 'GET') {
    try {
      const user = await getSession(req);
      if (!user || !user.stripe_customer_id) {
        return res.writeHead(302, { Location: '/app' }).end();
      }

      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const hostHeader = req.headers.host;
      const baseUrl = `${protocol}://${hostHeader}`;

      const portalSession = await stripe.billingPortal.sessions.create({
        customer: user.stripe_customer_id,
        return_url: `${baseUrl}/app`,
      });

      return res.writeHead(302, { Location: portalSession.url }).end();
    } catch (err) {
      console.error('Billing portal error:', err);
      return res.writeHead(302, { Location: '/app' }).end();
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

// ===== ANONYMOUS SINGLE-VIDEO CHECKOUT =====
async function handleSingleCredit(req, res) {
  const { session_id } = req.query;

  // Verify mode (returning from Stripe)
  if (session_id) {
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const session = await stripe.checkout.sessions.retrieve(session_id);

      if (session.payment_status !== 'paid') {
        return res.writeHead(302, { Location: '/app?payment=error' }).end();
      }

      const token = await createSingleCredit(session.id);
      setCreditCookie(res, token);

      res.writeHead(302, { Location: '/app?payment=single_success' });
      res.end();
    } catch (err) {
      console.error('Verify-single error:', err);
      res.writeHead(302, { Location: '/app?payment=error' });
      res.end();
    }
    return;
  }

  // Start checkout mode
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const hostHeader = req.headers.host;
    const baseUrl = `${protocol}://${hostHeader}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price: process.env.STRIPE_SINGLE_PRICE_ID,
        quantity: 1,
      }],
      success_url: `${baseUrl}/api/checkout-single?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/app`,
    });

    res.writeHead(302, { Location: session.url });
    res.end();
  } catch (err) {
    console.error('Checkout-single error:', err);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
