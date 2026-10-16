/**
 * Real-money purchases through Stripe Checkout (cards, PayPal, Apple Pay,
 * Google Pay — whatever is switched on in the Stripe dashboard).
 *
 * Flow: the player picks a product → we create a pending payment and a Checkout
 * Session with the server's own price → the player pays on Stripe's page →
 * Stripe calls our webhook (signed) → we deliver the coins / VIP exactly once.
 * The return page also asks Stripe directly, so a slow webhook never leaves the
 * player waiting. Card data never touches this server.
 */
import Stripe from 'stripe';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { paidProduct, euro } from '@/lib/game/payments';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { payments, users } from '@/server/db/schema';
import { postCoins } from '@/server/game/coins';
import { fail } from '@/server/game/errors';
import { notify } from '@/server/game/notify';

type Payment = typeof payments.$inferSelect;

/** Everything the shop needs before it may take money. Secrets stay on the server. */
export function paymentConfig() {
  const env = process.env;
  const missing = [!env.STRIPE_SECRET_KEY && 'STRIPE_SECRET_KEY', !env.STRIPE_WEBHOOK_SECRET && 'STRIPE_WEBHOOK_SECRET', !env.APP_URL && 'APP_URL', !env.SELLER_NAME && 'SELLER_NAME', !env.SUPPORT_EMAIL && 'SUPPORT_EMAIL'].filter(
    (x): x is string => !!x,
  );
  return {
    enabled: missing.length === 0,
    missing,
    testMode: env.STRIPE_SECRET_KEY?.startsWith('sk_test_') ?? false,
    seller: {
      name: env.SELLER_NAME ?? '',
      id: env.SELLER_ID ?? '',
      address: env.SELLER_ADDRESS ?? '',
      email: env.SUPPORT_EMAIL ?? '',
    },
  };
}

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
  if (!key) fail('payments_disabled', 'Плащанията още не са включени.', 503);
  client ??= new Stripe(key!, {
    maxNetworkRetries: 2,
    timeout: 20_000,
    appInfo: { name: 'TransVerse' },
  });
  return client;
}

// ── Checkout ──────────────────────────────────────────────────────────────

export const checkoutSchema = z.object({
  productId: z.string().max(40),
  /** EU: the buyer agrees that delivery starts at once and the right of withdrawal ends. */
  consent: z.literal(true, {
    error: 'Потвърдете, че желаете доставката да започне веднага.',
  }),
});

/** Creates a pending payment and a Stripe Checkout Session; returns the URL to send the player to. */
export async function createCheckout(db: Database, userId: string, raw: z.input<typeof checkoutSchema>, stripe: StripeLike = stripeClient(), now = new Date()) {
  const input = checkoutSchema.parse(raw);
  const config = paymentConfig();
  if (!config.enabled) fail('payments_disabled', 'Плащанията още не са включени.', 503);
  const product = paidProduct(input.productId);
  if (!product) fail('unknown_product', 'Непознат продукт.');
  const [user] = await db.select({ email: users.email, bannedAt: users.bannedAt }).from(users).where(eq(users.id, userId));
  if (!user || user.bannedAt) fail('forbidden', 'Профилът не може да прави покупки.', 403);
  // At most a few unfinished checkouts at a time (stops spamming Stripe).
  const [{ open = 0 } = {}] = await db
    .select({ open: sql<number>`count(*)::int` })
    .from(payments)
    .where(and(eq(payments.userId, userId), eq(payments.status, 'pending'), sql`${payments.createdAt} > ${new Date(now.getTime() - 3_600_000)}`));
  if (open >= 5) fail('too_many_checkouts', 'Имате няколко незавършени плащания. Опитайте отново след малко.', 429);

  const [payment] = await db
    .insert(payments)
    .values({
      userId,
      productId: product!.id,
      coins: product!.coins,
      vipDays: product!.vipDays,
      amountCents: product!.priceCents,
      currency: 'eur',
      consentAt: now,
    })
    .returning();
  const base = process.env.APP_URL!.replace(/\/$/, '');
  const tax = process.env.STRIPE_AUTOMATIC_TAX === 'true';
  let session: { id: string; url: string | null };
  try {
    session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        locale: 'bg',
        customer_email: user!.email,
        client_reference_id: payment!.id,
        metadata: { paymentId: payment!.id, userId, productId: product!.id },
        payment_intent_data: { metadata: { paymentId: payment!.id, userId } },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'eur',
              unit_amount: product!.priceCents,
              product_data: {
                name: `TransVerse · ${product!.label}`,
                description: product!.description,
              },
              ...(tax ? { tax_behavior: 'inclusive' as const } : {}),
            },
          },
        ],
        ...(tax ? { automatic_tax: { enabled: true } } : {}),
        expires_at: Math.floor(now.getTime() / 1000) + 60 * 60,
        success_url: `${base}/game/shop/payment?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${base}/game/shop?payment=cancelled`,
      },
      { idempotencyKey: `checkout:${payment!.id}` },
    );
  } catch (error) {
    console.error('[payments] checkout session failed', error);
    await db.update(payments).set({ status: 'failed' }).where(eq(payments.id, payment!.id));
    fail('checkout_failed', 'Плащането не можа да започне. Опитайте отново по-късно.', 502);
  }
  await db.update(payments).set({ checkoutSessionId: session!.id }).where(eq(payments.id, payment!.id));
  if (!session!.url) fail('checkout_failed', 'Плащането не можа да започне. Опитайте отново.', 502);
  return { paymentId: payment!.id, url: session!.url! };
}

// ── Fulfilment ────────────────────────────────────────────────────────────

const DAY = 86_400_000;

/** Delivers a paid order exactly once: coins through the coin ledger, VIP days on top of the current ones. */
async function deliver(tx: Tx, p: Payment, now: Date) {
  if (p.coins)
    await postCoins(tx, p.userId, {
      amount: p.coins,
      reason: 'purchase',
      description: `Покупка: ${paidProduct(p.productId)?.label ?? p.productId}`,
      idempotencyKey: `payment:${p.id}`,
    });
  if (p.vipDays) {
    const [u] = await tx.select({ vipUntil: users.vipUntil }).from(users).where(eq(users.id, p.userId)).for('update');
    await tx
      .update(users)
      .set({
        vipUntil: new Date(Math.max(now.getTime(), u?.vipUntil?.getTime() ?? 0) + p.vipDays * DAY),
      })
      .where(eq(users.id, p.userId));
  }
  const label = paidProduct(p.productId)?.label ?? p.productId;
  await notify(tx, p.userId, 'success', 'Плащането е получено', `${label} — добавено към профила ти. Благодарим за подкрепата!`, '/game/shop');
}

/**
 * Applies a Checkout Session we got from Stripe (webhook or a direct lookup).
 * Pays out only when Stripe says it is paid and the amount and currency are
 * exactly what we asked for. Safe to call any number of times.
 */
export async function applyCheckoutSession(db: Database, session: Pick<Stripe.Checkout.Session, 'id' | 'payment_status' | 'status' | 'amount_total' | 'currency' | 'payment_intent'>, now = new Date()) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.checkoutSessionId, session.id)).for('update');
    if (!p) return 'unknown' as const;
    if (p.status === 'paid' || p.status === 'refunded') return p.status;
    const intent = typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? null);
    if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
      if (session.amount_total !== p.amountCents || session.currency?.toLowerCase() !== p.currency) {
        console.error('[payments] amount mismatch', {
          payment: p.id,
          expected: p.amountCents,
          got: session.amount_total,
          currency: session.currency,
        });
        await tx.update(payments).set({ status: 'failed', paymentIntentId: intent }).where(eq(payments.id, p.id));
        return 'failed' as const;
      }
      await tx.update(payments).set({ status: 'paid', paidAt: now, paymentIntentId: intent }).where(eq(payments.id, p.id));
      await deliver(tx, p, now);
      return 'paid' as const;
    }
    if (session.status === 'expired') {
      await tx.update(payments).set({ status: 'expired' }).where(eq(payments.id, p.id));
      return 'expired' as const;
    }
    if (intent && intent !== p.paymentIntentId) await tx.update(payments).set({ paymentIntentId: intent }).where(eq(payments.id, p.id));
    return 'pending' as const;
  });
}

/** A delayed method (e.g. bank transfer) failed. */
async function markFailed(db: Database, sessionId: string) {
  await db
    .update(payments)
    .set({ status: 'failed' })
    .where(and(eq(payments.checkoutSessionId, sessionId), eq(payments.status, 'pending')));
}

/** A paid order was refunded (fully): the coins and VIP days are taken back. */
export async function applyRefund(db: Database, paymentIntentId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.paymentIntentId, paymentIntentId)).for('update');
    if (!p || p.status !== 'paid') return false;
    await tx.update(payments).set({ status: 'refunded', refundedAt: now }).where(eq(payments.id, p.id));
    // The balance may go below zero if the coins were already spent; nothing more can be bought until it is positive.
    if (p.coins)
      await postCoins(tx, p.userId, {
        amount: -p.coins,
        reason: 'payment_refund',
        description: `Върнато плащане: ${paidProduct(p.productId)?.label ?? p.productId}`,
        idempotencyKey: `payment-refund:${p.id}`,
      });
    if (p.vipDays) {
      const [u] = await tx.select({ vipUntil: users.vipUntil }).from(users).where(eq(users.id, p.userId)).for('update');
      if (u?.vipUntil)
        await tx
          .update(users)
          .set({ vipUntil: new Date(u.vipUntil.getTime() - p.vipDays * DAY) })
          .where(eq(users.id, p.userId));
    }
    await notify(tx, p.userId, 'warning', 'Плащането е възстановено', `Сумата ${euro(p.amountCents)} е върната; съответните ТрансКоин / VIP дни са премахнати.`, '/game/shop');
    return true;
  });
}

// ── Webhook ───────────────────────────────────────────────────────────────

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
      await markFailed(db, event.data.object.id);
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
  const [p] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.checkoutSessionId, sessionId), eq(payments.userId, userId)));
  if (!p) return null;
  if (p.status === 'pending' && paymentConfig().enabled) {
    try {
      const session = await (stripe ?? stripeClient()).checkout.sessions.retrieve(sessionId);
      await applyCheckoutSession(db, session);
    } catch (error) {
      console.error('[payments] could not refresh checkout session', error);
    }
  }
  const [fresh] = await db.select().from(payments).where(eq(payments.id, p.id));
  return fresh!;
}

// ── Views ─────────────────────────────────────────────────────────────────

export async function userPayments(db: DbOrTx, userId: string, limit = 10) {
  return db.select().from(payments).where(eq(payments.userId, userId)).orderBy(desc(payments.createdAt)).limit(limit);
}

export async function adminPayments(db: DbOrTx, limit = 100) {
  const rows = await db.select({ payment: payments, username: users.username }).from(payments).innerJoin(users, eq(users.id, payments.userId)).orderBy(desc(payments.createdAt)).limit(limit);
  const [totals] = await db
    .select({
      paid: sql<number>`coalesce(sum(${payments.amountCents}) filter (where ${payments.status} = 'paid'), 0)::int`,
      paidCount: sql<number>`count(*) filter (where ${payments.status} = 'paid')::int`,
      refunded: sql<number>`coalesce(sum(${payments.amountCents}) filter (where ${payments.status} = 'refunded'), 0)::int`,
      last30: sql<number>`coalesce(sum(${payments.amountCents}) filter (where ${payments.status} = 'paid' and ${payments.paidAt} > now() - interval '30 days'), 0)::int`,
    })
    .from(payments);
  return { rows, totals: totals! };
}
