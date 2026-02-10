// api/checkout-single.js — Anonymous $5 single-video checkout + verification
// No session_id param → create Stripe checkout and redirect
// With session_id param → verify payment, set credit cookie, redirect to app

import Stripe from 'stripe';
import { createSingleCredit, setCreditCookie } from './_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { session_id } = req.query;

  // ===== VERIFY MODE (returning from Stripe) =====
  if (session_id) {
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const session = await stripe.checkout.sessions.retrieve(session_id);

      if (session.payment_status !== 'paid') {
        return res.writeHead(302, { Location: '/app?payment=error' }).end();
      }

      // Create credit token and set cookie
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

  // ===== CHECKOUT MODE (start new purchase) =====
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    const baseUrl = `${protocol}://${host}`;

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
