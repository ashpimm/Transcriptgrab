// api/verify.js
// Verifies a Stripe Checkout Session was actually paid.
// Called by the frontend after Stripe redirects back with a session ID.
//
// Usage: GET /api/verify?session_id=cs_test_xxx

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

export default async function handler(req, res) {
  // CORS — restrict to same origin
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  const allowed = !origin || origin.includes(host);
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin || '*' : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sessionId = req.query.session_id;

  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ verified: false, error: 'Missing session_id parameter' });
  }

  // Validate format: Stripe Checkout Session IDs start with cs_
  if (!sessionId.startsWith('cs_') || sessionId.length > 256) {
    return res.status(400).json({ verified: false, error: 'Invalid session_id format' });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ verified: false, error: 'Stripe is not configured' });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status === 'paid') {
      // Derive tier from the amount paid (in cents)
      const amountCents = session.amount_total;
      const tier = tierFromAmount(amountCents);

      return res.status(200).json({
        verified: true,
        tier,
        amountPaid: amountCents / 100,
      });
    }

    return res.status(200).json({ verified: false, error: 'Payment not completed' });

  } catch (err) {
    console.error('Stripe verify error:', err.message);
    // Stripe throws for invalid/nonexistent session IDs
    return res.status(200).json({ verified: false, error: 'Invalid or expired session' });
  }
}

function tierFromAmount(cents) {
  // Match amount to tier. Amounts in cents.
  if (cents <= 299) return 'starter';
  if (cents <= 499) return 'standard';
  if (cents <= 1499) return 'pro';
  return 'max';
}
