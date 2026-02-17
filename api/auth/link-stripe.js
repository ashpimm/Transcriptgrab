// api/auth/link-stripe.js — Link Stripe payment to user after checkout redirect

import Stripe from 'stripe';
import { getSession, setProStatus, incrementCredits, updateUser, claimCheckoutSession } from '../_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

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

    // Verify this session belongs to the current user
    if (session.client_reference_id !== String(user.id)) {
      return res.writeHead(302, { Location: '/app?payment=error' }).end();
    }

    // Idempotency — only grant once per session_id
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
