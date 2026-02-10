// api/verify-single.js — Verify $5 payment, set credit cookie, redirect to app

import Stripe from 'stripe';
import { createSingleCredit, setCreditCookie } from './_db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { session_id } = req.query;
  if (!session_id) {
    return res.writeHead(302, { Location: '/app?payment=error' }).end();
  }

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
    // Could be duplicate stripe_session_id (replay) — just redirect
    res.writeHead(302, { Location: '/app?payment=error' });
    res.end();
  }
}
