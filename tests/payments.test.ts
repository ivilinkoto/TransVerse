import Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/server/db/client';
import { coinEntries, payments, users } from '@/server/db/schema';
import { GameError } from '@/server/game/errors';
import { createCheckout, handleStripeEvent, paymentConfig, syncReturn, verifyWebhook, type StripeLike } from '@/server/payments';
import { db, newPlayer } from './helpers';

const SECRET = 'whsec_test_secret';
const ENV = { STRIPE_SECRET_KEY: 'sk_test_dummy', STRIPE_WEBHOOK_SECRET: SECRET, APP_URL: 'https://transverse.example', SELLER_NAME: 'Тест Търговец', SUPPORT_EMAIL: 'help@example.com' };
beforeAll(() => Object.assign(process.env, ENV));
afterAll(async () => {
  for (const k of Object.keys(ENV)) delete process.env[k];
  await closeDb();
});

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).name));

/** A stand-in for Stripe's API: remembers created sessions; tests decide how they look when retrieved. */
function fakeStripe() {
  const created: Stripe.Checkout.SessionCreateParams[] = [];
  const sessions = new Map<string, Partial<Stripe.Checkout.Session>>();
  let n = 0;
  const stripe: StripeLike = {
    checkout: {
      sessions: {
        create: async (params) => {
          created.push(params);
          const id = `cs_test_${Date.now()}_${n++}`;
          sessions.set(id, { id, payment_status: 'unpaid', status: 'open', amount_total: params.line_items![0]!.price_data!.unit_amount!, currency: 'eur', payment_intent: null });
          return { id, url: `https://checkout.stripe.com/c/pay/${id}` };
        },
        retrieve: async (id) => sessions.get(id) as Stripe.Checkout.Session,
      },
    },
  };
  return { stripe, created, sessions };
}

/** A webhook call exactly as Stripe sends it: JSON body plus a signature header. */
function signed(type: string, object: Record<string, unknown>, secret = SECRET) {
  const payload = JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, object: 'event', type, data: { object } });
  return { payload, header: Stripe.webhooks.generateTestHeaderString({ payload, secret }) };
}

const coinsOf = async (userId: string) => (await db().select({ coins: users.coins }).from(users).where(eq(users.id, userId)))[0]!.coins;

describe('payments', () => {
  it('is switched off until every setting is present', () => {
    expect(paymentConfig().stripe.enabled).toBe(true);
    expect(paymentConfig().stripe.testMode).toBe(true);
    const saved = process.env.SELLER_NAME;
    delete process.env.SELLER_NAME;
    expect(paymentConfig().stripe).toMatchObject({ enabled: false, missing: ['SELLER_NAME'] });
    expect(paymentConfig().enabled).toBe(false);
    process.env.SELLER_NAME = saved;
  });

  it('creates a checkout with the server price and needs the withdrawal consent', async () => {
    const p = await newPlayer();
    const { stripe, created } = fakeStripe();
    expect(await code(createCheckout(db(), p.userId, { productId: 'tc_550', consent: false as unknown as true }, stripe))).toBe('ZodError');
    expect(await code(createCheckout(db(), p.userId, { productId: 'free_money', consent: true }, stripe))).toBe('unknown_product');
    const { url, paymentId } = await createCheckout(db(), p.userId, { productId: 'tc_550', consent: true }, stripe);
    expect(url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    const params = created.at(-1)!;
    expect(params.line_items![0]!.price_data).toMatchObject({ currency: 'eur', unit_amount: 999 });
    expect(params.metadata).toMatchObject({ paymentId, userId: p.userId, productId: 'tc_550' });
    expect(params.success_url).toBe('https://transverse.example/game/shop/payment?session_id={CHECKOUT_SESSION_ID}');
    const [row] = await db().select().from(payments).where(eq(payments.id, paymentId));
    expect(row).toMatchObject({ status: 'pending', amountCents: 999, coins: 550 });
    expect(row!.checkoutSessionId).toMatch(/^cs_test_/);
  });

  it('delivers once on a signed webhook, rejects forged ones and takes coins back on refund', async () => {
    const p = await newPlayer();
    const { stripe } = fakeStripe();
    const { paymentId } = await createCheckout(db(), p.userId, { productId: 'tc_550', consent: true }, stripe);
    const [row] = await db().select().from(payments).where(eq(payments.id, paymentId));
    const session = { id: row!.checkoutSessionId, object: 'checkout.session', payment_status: 'paid', status: 'complete', amount_total: 999, currency: 'eur', payment_intent: 'pi_test_1' };

    // Forged: wrong secret, or a body changed after signing.
    const forged = signed('checkout.session.completed', session, 'whsec_attacker');
    expect(() => verifyWebhook(forged.payload, forged.header)).toThrow();
    const ok = signed('checkout.session.completed', session);
    expect(() => verifyWebhook(ok.payload.replace('999', '1'), ok.header)).toThrow();
    expect(() => verifyWebhook(ok.payload, null)).toThrow();

    expect(await handleStripeEvent(db(), verifyWebhook(ok.payload, ok.header))).toBe('paid');
    expect(await coinsOf(p.userId)).toBe(550);
    // Stripe retries and duplicates events — nothing is delivered twice.
    const again = signed('checkout.session.completed', session);
    expect(await handleStripeEvent(db(), verifyWebhook(again.payload, again.header))).toBe('paid');
    expect(await coinsOf(p.userId)).toBe(550);
    expect(await db().select().from(coinEntries).where(eq(coinEntries.idempotencyKey, `payment:${paymentId}`))).toHaveLength(1);

    const refund = signed('charge.refunded', { id: 'ch_1', object: 'charge', payment_intent: 'pi_test_1', refunded: true });
    await handleStripeEvent(db(), verifyWebhook(refund.payload, refund.header));
    await handleStripeEvent(db(), verifyWebhook(refund.payload, refund.header));
    expect(await coinsOf(p.userId)).toBe(0);
    expect((await db().select().from(payments).where(eq(payments.id, paymentId)))[0]!.status).toBe('refunded');
  });

  it('never delivers when the paid amount differs or the payment is still unpaid', async () => {
    const p = await newPlayer();
    const { stripe } = fakeStripe();
    const a = await createCheckout(db(), p.userId, { productId: 'tc_3200', consent: true }, stripe);
    const [ra] = await db().select().from(payments).where(eq(payments.id, a.paymentId));
    const cheap = signed('checkout.session.completed', { id: ra!.checkoutSessionId, object: 'checkout.session', payment_status: 'paid', status: 'complete', amount_total: 199, currency: 'eur', payment_intent: 'pi_x' });
    expect(await handleStripeEvent(db(), verifyWebhook(cheap.payload, cheap.header))).toBe('failed');

    const b = await createCheckout(db(), p.userId, { productId: 'tc_100', consent: true }, stripe);
    const [rb] = await db().select().from(payments).where(eq(payments.id, b.paymentId));
    const unpaid = signed('checkout.session.completed', { id: rb!.checkoutSessionId, object: 'checkout.session', payment_status: 'unpaid', status: 'complete', amount_total: 199, currency: 'eur', payment_intent: 'pi_y' });
    expect(await handleStripeEvent(db(), verifyWebhook(unpaid.payload, unpaid.header))).toBe('pending');
    const failed = signed('checkout.session.async_payment_failed', { id: rb!.checkoutSessionId, object: 'checkout.session' });
    await handleStripeEvent(db(), verifyWebhook(failed.payload, failed.header));
    expect((await db().select().from(payments).where(eq(payments.id, b.paymentId)))[0]!.status).toBe('failed');
    expect(await coinsOf(p.userId)).toBe(0);
  });

  it('the return page confirms with Stripe directly; VIP is added on top; other players see nothing', async () => {
    const p = await newPlayer();
    const other = await newPlayer();
    const { stripe, sessions } = fakeStripe();
    const { paymentId } = await createCheckout(db(), p.userId, { productId: 'vip_30_direct', consent: true }, stripe);
    const [row] = await db().select().from(payments).where(eq(payments.id, paymentId));
    const id = row!.checkoutSessionId!;
    expect(await syncReturn(db(), other.userId, id, stripe)).toBeNull();
    expect((await syncReturn(db(), p.userId, id, stripe))!.status).toBe('pending');
    sessions.set(id, { ...sessions.get(id), payment_status: 'paid', status: 'complete', payment_intent: 'pi_vip' });
    expect((await syncReturn(db(), p.userId, id, stripe))!.status).toBe('paid');
    const [u] = await db().select({ vipUntil: users.vipUntil }).from(users).where(eq(users.id, p.userId));
    expect(Math.round((u!.vipUntil!.getTime() - Date.now()) / 86_400_000)).toBe(30);
  });
});

describe('provider errors for the admin panel', () => {
  it('Stripe errors keep the explanation but never a key', async () => {
    const { describeFailure } = await import('@/server/payments');
    const text = describeFailure({ type: 'StripeInvalidRequestError', code: 'parameter_invalid', param: 'locale', message: 'Invalid API Key provided: rk_live_********abcd. In order to use Checkout, you must set an account or business name.', requestId: 'req_123' });
    expect(text).toContain('StripeInvalidRequestError');
    expect(text).toContain('поле locale');
    expect(text).toContain('business name');
    expect(text).toContain('req_123');
    expect(text).not.toContain('rk_live');
  });
});
