// api/verify.js
// Verifies Pro subscription status via Stripe.
//
// Modes:
//   GET /api/verify?session_id=cs_xxx   — Verify checkout session (payment return)
//   GET /api/verify?email=user@test.com  — Restore subscription by email
//   GET /api/verify?subscription_id=sub_xxx — Re-verify active subscription

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

// In-memory cache: subscriptionId -> { active, verifiedAt }
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function getCached(subId) {
  const entry = cache.get(subId);
  if (entry && (Date.now() - entry.verifiedAt) < CACHE_TTL) return entry;
  return null;
}

function setCache(subId, active) {
  cache.set(subId, { active, verifiedAt: Date.now() });
}

export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  const allowed = !origin || (function() { try { return new URL(origin).host === host; } catch { return false; } })();
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-subscription-id');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ verified: false, error: 'Stripe is not configured' });
  }

  const { session_id, email, subscription_id } = req.query;

  try {
    // ===== MODE 1: Verify checkout session (payment return) =====
    if (session_id) {
      if (!session_id.startsWith('cs_') || session_id.length > 256) {
        return res.status(400).json({ verified: false, error: 'Invalid session_id format' });
      }

      const session = await stripe.checkout.sessions.retrieve(session_id);

      if (session.payment_status === 'paid' && session.subscription) {
        const subId = typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription.id;

        setCache(subId, true);

        return res.status(200).json({
          verified: true,
          subscriptionId: subId,
          customerEmail: session.customer_details?.email || '',
          status: 'active',
        });
      }

      return res.status(200).json({ verified: false, error: 'Payment not completed or no subscription found' });
    }

    // ===== MODE 2: Restore by email =====
    if (email) {
      if (typeof email !== 'string' || email.length > 256) {
        return res.status(400).json({ verified: false, error: 'Invalid email' });
      }

      // Find customers with this email
      const customers = await stripe.customers.list({ email: email.trim().toLowerCase(), limit: 5 });

      for (const customer of customers.data) {
        // Check for active subscriptions
        const subs = await stripe.subscriptions.list({
          customer: customer.id,
          status: 'active',
          limit: 1,
        });

        if (subs.data.length > 0) {
          const sub = subs.data[0];
          setCache(sub.id, true);

          return res.status(200).json({
            verified: true,
            subscriptionId: sub.id,
            customerEmail: email.trim().toLowerCase(),
            status: 'active',
          });
        }
      }

      return res.status(200).json({ verified: false, error: 'No active subscription found for this email' });
    }

    // ===== MODE 3: Re-verify subscription ID =====
    if (subscription_id) {
      if (typeof subscription_id !== 'string' || !subscription_id.startsWith('sub_')) {
        return res.status(400).json({ verified: false, error: 'Invalid subscription_id format' });
      }

      // Check cache first
      const cached = getCached(subscription_id);
      if (cached) {
        return res.status(200).json({
          verified: cached.active,
          subscriptionId: subscription_id,
          status: cached.active ? 'active' : 'inactive',
        });
      }

      const sub = await stripe.subscriptions.retrieve(subscription_id);
      const isActive = sub.status === 'active' || sub.status === 'trialing';
      setCache(subscription_id, isActive);

      return res.status(200).json({
        verified: isActive,
        subscriptionId: subscription_id,
        status: sub.status,
      });
    }

    return res.status(400).json({ verified: false, error: 'Provide session_id, email, or subscription_id' });

  } catch (err) {
    console.error('Stripe verify error:', err.message);
    return res.status(200).json({ verified: false, error: 'Invalid or expired session' });
  }
}
