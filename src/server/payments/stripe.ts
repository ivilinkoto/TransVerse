/**
 * Stripe Checkout (needs the site on HTTPS for the webhook).
 * Stripe calls our webhook (signed) and the return page also asks Stripe
 * directly; delivery goes through the shared, exactly-once code.
 */
import Stripe from 'stripe';
import { and, eq } from 'drizzle-orm';
import type { Database } from '@/server/db/client';
import { payments } from '@/server/db/schema';
import { fail } from '@/server/game/errors';
import { checkoutSchema, describeFailure, markPaymentFailed, paymentConfig, refundLocked, settlePaid, siteUrl, startPayment, type CheckoutInput } from './common';
import { t } from '@/i18n/t';

/** The part of the Stripe client we use (an interface so tests can pass a fake). */
export interface StripeLike {
  checkout: {
    sessions: {
      create(params: Stripe.Checkout.SessionCreateParams, options?: Stripe.RequestOptions): Promise<{ id: string; url: string | null }>;
      retrieve(id: string): Promise<Stripe.Checkout.Session>;
    };
  };
}

let client: Stripe | null = null;
export function stripeClient(): StripeLike {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) fail('payments_disabled', t('Плащанията с карта още не са включени.'), 503);
  client ??= new Stripe(key!, { maxNetworkRetries: 2, timeout: 20_000, appInfo: { name: 'TransVerse' } });
  return client;
}

/** Creates a pending payment and a Stripe Checkout Session; returns the URL to send the player to. */
export async function createCheckout(db: Database, userId: string, raw: CheckoutInput, stripe?: StripeLike, now = new Date(), origin?: string | null) {
  const input = checkoutSchema.parse({ ...raw, provider: 'stripe' });
  if (!paymentConfig().stripe.enabled) fail('payments_disabled', t('Плащанията с карта още не са включени.'), 503);
  const base = siteUrl(origin);
  const { payment, product, email } = await startPayment(db, userId, input, now);
  const tax = process.env.STRIPE_AUTOMATIC_TAX === 'true';
  let session: { id: string; url: string | null };
  try {
    session = await (stripe ?? stripeClient()).checkout.sessions.create(
      {
        mode: 'payment',
        locale: 'bg',
        customer_email: email,
        client_reference_id: payment.id,
        metadata: { paymentId: payment.id, userId, productId: product.id },
        payment_intent_data: { metadata: { paymentId: payment.id, userId } },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'eur',
              unit_amount: product.priceCents,
              product_data: { name: `TransVerse · ${product.label}`, description: product.description },
              ...(tax ? { tax_behavior: 'inclusive' as const } : {}),
            },
          },
        ],
        ...(tax ? { automatic_tax: { enabled: true } } : {}),
        // We sell as the merchant (as with PayPal), not through Stripe's Managed Payments, which is on by default for new accounts.
        managed_payments: { enabled: false },
        expires_at: Math.floor(now.getTime() / 1000) + 60 * 60,
        success_url: `${base}/game/shop/payment?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${base}/game/shop?payment=cancelled`,
      },
      { idempotencyKey: `checkout:${payment.id}` },
    );
  } catch (error) {
    console.error('[payments] stripe checkout failed', error);
    await markPaymentFailed(db, payment.id, describeFailure(error));
    fail('checkout_failed', t('Плащането не можа да започне. Опитайте отново по-късно.'), 502);
  }
  await db.update(payments).set({ checkoutSessionId: session!.id }).where(eq(payments.id, payment.id));
  if (!session!.url) fail('checkout_failed', t('Плащането не можа да започне. Опитайте отново.'), 502);
  return { paymentId: payment.id, url: session!.url! };
}

/** Applies a Checkout Session from Stripe (webhook or direct lookup). Safe to call any number of times. */
export async function applyCheckoutSession(db: Database, session: Pick<Stripe.Checkout.Session, 'id' | 'payment_status' | 'status' | 'amount_total' | 'currency' | 'payment_intent'>, now = new Date()) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.checkoutSessionId, session.id)).for('update');
    if (!p) return 'unknown' as const;
    if (p.status === 'paid' || p.status === 'refunded') return p.status;
    const intent = typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? null);
    if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
      return settlePaid(tx, p, { amountCents: session.amount_total, currency: session.currency }, { paymentIntentId: intent }, now);
    }
    if (session.status === 'expired') {
      await tx.update(payments).set({ status: 'expired' }).where(eq(payments.id, p.id));
      return 'expired' as const;
    }
    if (intent && intent !== p.paymentIntentId) await tx.update(payments).set({ paymentIntentId: intent }).where(eq(payments.id, p.id));
    return 'pending' as const;
  });
}

/** Full refund made in the Stripe dashboard. */
export async function applyRefund(db: Database, paymentIntentId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.paymentIntentId, paymentIntentId)).for('update');
    return p ? refundLocked(tx, p, now) : false;
  });
}

/** Verifies Stripe's signature over the raw body. Throws on anything not signed by Stripe. */
export function verifyWebhook(rawBody: string, signature: string | null, secret = process.env.STRIPE_WEBHOOK_SECRET): Stripe.Event {
  if (!secret || !signature) throw new Error('missing webhook signature or secret');
  return Stripe.webhooks.constructEvent(rawBody, signature, secret);
}

/** Handles the events we subscribe to. Unknown events are acknowledged and ignored. */
export async function handleStripeEvent(db: Database, event: Stripe.Event, now = new Date()) {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
    case 'checkout.session.expired':
      return applyCheckoutSession(db, event.data.object, now);
    case 'checkout.session.async_payment_failed':
      await db.update(payments).set({ status: 'failed' }).where(and(eq(payments.checkoutSessionId, event.data.object.id), eq(payments.status, 'pending')));
      return 'failed';
    case 'charge.refunded': {
      const charge = event.data.object;
      const intent = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
      if (intent && charge.refunded) await applyRefund(db, intent, now);
      return 'refund';
    }
    default:
      return 'ignored';
  }
}

/** Return page: if the webhook has not arrived yet, ask Stripe directly. */
export async function syncReturn(db: Database, userId: string, sessionId: string, stripe?: StripeLike) {
  const [p] = await db.select().from(payments).where(and(eq(payments.checkoutSessionId, sessionId), eq(payments.userId, userId)));
  if (!p) return null;
  if (p.status === 'pending' && (stripe || paymentConfig().stripe.enabled)) {
    try {
      await applyCheckoutSession(db, await (stripe ?? stripeClient()).checkout.sessions.retrieve(sessionId));
    } catch (error) {
      console.error('[payments] could not refresh checkout session', error);
    }
  }
  const [fresh] = await db.select().from(payments).where(eq(payments.id, p.id));
  return fresh!;
}
