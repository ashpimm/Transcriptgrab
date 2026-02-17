// api/webhook.js — Stripe webhook for subscription lifecycle events

import Stripe from 'stripe';
import { downgradeUser, findUserByStripeCustomer, setProStatus, claimCheckoutSession, incrementCredits, updateUser } from './_db.js';

export const config = {
  api: {
    bodyParser: false, // Need raw body for Stripe signature verification
  },
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET not configured');
    return res.status(500).end();
  }

  let event;
  try {
    const rawBody = await getRawBody(req);
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        // Authoritative credit/pro grant for signed-in users.
        // Anonymous $5 purchases have no client_reference_id — handled by redirect only.
        const session = event.data.object;
        const userId = parseInt(session.client_reference_id, 10);
        if (!userId || session.payment_status !== 'paid') break;

        // Idempotent — if the redirect already claimed this, this is a no-op
        const claimed = await claimCheckoutSession(session.id, userId);
        if (!claimed) break;

        const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;

        if (session.mode === 'subscription' && session.subscription) {
          const subId = typeof session.subscription === 'string'
            ? session.subscription : session.subscription.id;
          await setProStatus(userId, customerId, subId);
        } else {
          await incrementCredits(userId);
          if (customerId) {
            await updateUser(userId, { stripe_customer_id: customerId });
          }
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        if (sub.status === 'active' || sub.status === 'trialing') {
          // Subscription reactivated — upgrade user
          const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
          const user = await findUserByStripeCustomer(customerId);
          if (user && user.tier !== 'pro') {
            await setProStatus(user.id, customerId, sub.id);
          }
        } else if (sub.status === 'past_due' || sub.status === 'unpaid' || sub.status === 'canceled') {
          await downgradeUser(sub.id);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await downgradeUser(sub.id);
        break;
      }

      default:
        // Ignore other event types
        break;
    }
  } catch (err) {
    console.error('Webhook handler error:', err);
  }

  return res.status(200).json({ received: true });
}
