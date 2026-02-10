// api/checkout-single.js — Anonymous $5 single-video checkout (no auth required)

import Stripe from 'stripe';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
      success_url: `${baseUrl}/api/verify-single?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/app`,
    });

    res.writeHead(302, { Location: session.url });
    res.end();
  } catch (err) {
    console.error('Checkout-single error:', err);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
