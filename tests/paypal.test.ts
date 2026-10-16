import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/server/db/client';
import { adminAudit, coinEntries, payments, users } from '@/server/db/schema';
import { GameError } from '@/server/game/errors';
import { confirmPaypalOrder, createPaypalCheckout, handlePaypalWebhook, paymentConfig, PayPalError, reconcilePaypal, refundPaypalPayment, type PayPalApi, type PayPalOrder } from '@/server/payments';
import { loadSecretsFile } from '@/server/secrets';
import { db, newPlayer } from './helpers';

const ENV = { PAYPAL_CLIENT_ID: 'test-client', PAYPAL_CLIENT_SECRET: 'test-secret', SELLER_NAME: 'Тест ЕООД', SUPPORT_EMAIL: 'help@example.com' };
beforeAll(() => {
  delete process.env.APP_URL;
  Object.assign(process.env, ENV);
});
afterAll(async () => {
  for (const k of [...Object.keys(ENV), 'PAYPAL_WEBHOOK_ID']) delete process.env[k];
  await closeDb();
});

const ORIGIN = 'http://203.0.113.10';
const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).name));
const coinsOf = async (userId: string) => (await db().select({ coins: users.coins }).from(users).where(eq(users.id, userId)))[0]!.coins;
const paymentOf = async (id: string) => (await db().select().from(payments).where(eq(payments.id, id)))[0]!;
const staff = async (role: 'admin' | 'support') => {
  const p = await newPlayer();
  await db().update(users).set({ role }).where(eq(users.id, p.userId));
  return { id: p.userId, role, username: p.username };
};

let n = 0;

/** Behaves like PayPal's Orders API for the calls we make (idempotent by PayPal-Request-Id). */
function fakePaypal() {
  type Stored = { id: string; status: string; value: string; currency: string; customId: string; capture?: { id: string; status: string; value: string; currency: string } };
  const orders = new Map<string, Stored>();
  const byRequest = new Map<string, string>();
  const bodies: unknown[] = [];
  const control = { captureStatus: 'COMPLETED', captureValue: null as string | null, verified: true, refunds: 0 };
  const view = (o: Stored): PayPalOrder => ({
    id: o.id,
    status: o.status,
    links: [{ rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=${o.id}` }],
    purchase_units: [{ custom_id: o.customId, payments: o.capture ? { captures: [{ id: o.capture.id, status: o.capture.status, amount: { currency_code: o.capture.currency, value: o.capture.value } }] } : undefined }],
  });
  const api: PayPalApi = {
    async createOrder(body, requestId) {
      bodies.push(body);
      const existing = byRequest.get(requestId);
      if (existing) return view(orders.get(existing)!);
      const unit = (body as { purchase_units: { custom_id: string; amount: { value: string; currency_code: string } }[] }).purchase_units[0]!;
      const id = `5O${String(++n).padStart(6, '0')}TESTORDER`;
      orders.set(id, { id, status: 'PAYER_ACTION_REQUIRED', value: unit.amount.value, currency: unit.amount.currency_code, customId: unit.custom_id });
      byRequest.set(requestId, id);
      return view(orders.get(id)!);
    },
    async captureOrder(orderId) {
      const o = orders.get(orderId);
      if (!o) throw new PayPalError(404, 'RESOURCE_NOT_FOUND', 'not found');
      if (o.status === 'COMPLETED') throw new PayPalError(422, 'ORDER_ALREADY_CAPTURED', 'already captured');
      if (o.status !== 'APPROVED') throw new PayPalError(422, 'ORDER_NOT_APPROVED', 'not approved');
      o.status = 'COMPLETED';
      o.capture = { id: `CAP${++n}`, status: control.captureStatus, value: control.captureValue ?? o.value, currency: o.currency };
      return view(o);
    },
    async getOrder(orderId) {
      const o = orders.get(orderId);
      if (!o) throw new PayPalError(404, 'RESOURCE_NOT_FOUND', 'not found');
      return view(o);
    },
    async refundCapture(captureId) {
      control.refunds++;
      return { id: `REF-${captureId}`, status: 'COMPLETED' };
    },
    async verifyWebhook() {
      return control.verified;
    },
  };
  const approve = (orderId: string) => (orders.get(orderId)!.status = 'APPROVED');
  return { api, approve, orders, bodies, control };
}

describe('PayPal payments', () => {
  it('is on with client id, secret and seller details; sandbox unless PAYPAL_ENV=live', () => {
    const c = paymentConfig();
    expect(c.paypal).toMatchObject({ enabled: true, sandbox: true });
    expect(c.providers).toContain('paypal');
    expect(c.testMode).toBe(true);
  });

  it('charges the server price, then delivers once after the buyer approves', async () => {
    const p = await newPlayer();
    const other = await newPlayer();
    const pp = fakePaypal();
    const { url, paymentId } = await createPaypalCheckout(db(), p.userId, { productId: 'tc_550', consent: true }, pp.api, new Date(), ORIGIN);
    expect(url).toMatch(/^https:\/\/www\.sandbox\.paypal\.com\//);
    const body = pp.bodies.at(-1) as { purchase_units: { amount: { value: string; currency_code: string }; custom_id: string; invoice_id: string }[]; payment_source: { paypal: { experience_context: { return_url: string } } } };
    expect(body.purchase_units[0]).toMatchObject({ amount: { value: '9.99', currency_code: 'EUR' }, custom_id: paymentId, invoice_id: paymentId });
    expect(body.payment_source.paypal.experience_context.return_url).toBe(`${ORIGIN}/game/shop/payment?provider=paypal`);
    const orderId = (await paymentOf(paymentId)).orderId!;

    // Coming back without approving changes nothing.
    expect((await confirmPaypalOrder(db(), orderId, { userId: p.userId, api: pp.api }))!.status).toBe('pending');
    pp.approve(orderId);
    // Another player cannot confirm someone else's order.
    expect(await confirmPaypalOrder(db(), orderId, { userId: other.userId, api: pp.api })).toBeNull();
    expect((await confirmPaypalOrder(db(), orderId, { userId: p.userId, api: pp.api }))!.status).toBe('paid');
    expect(await coinsOf(p.userId)).toBe(550);
    // Repeated return / worker / webhook: still delivered once.
    expect((await confirmPaypalOrder(db(), orderId, { api: pp.api }))!.status).toBe('paid');
    await reconcilePaypal(db(), new Date(Date.now() + 5 * 60_000), pp.api);
    expect(await coinsOf(p.userId)).toBe(550);
    expect(await db().select().from(coinEntries).where(eq(coinEntries.idempotencyKey, `payment:${paymentId}`))).toHaveLength(1);
    expect((await paymentOf(paymentId)).captureId).toMatch(/^CAP/);
  });

  it('the worker finishes approved orders whose buyer never came back and expires abandoned ones', async () => {
    const p = await newPlayer();
    const pp = fakePaypal();
    const a = await createPaypalCheckout(db(), p.userId, { productId: 'vip_30_direct', consent: true }, pp.api, new Date(), ORIGIN);
    const b = await createPaypalCheckout(db(), p.userId, { productId: 'tc_100', consent: true }, pp.api, new Date(), ORIGIN);
    pp.approve((await paymentOf(a.paymentId)).orderId!);
    await reconcilePaypal(db(), new Date(Date.now() + 2 * 60_000), pp.api);
    expect((await paymentOf(a.paymentId)).status).toBe('paid');
    const [u] = await db().select({ vipUntil: users.vipUntil }).from(users).where(eq(users.id, p.userId));
    expect(Math.round((u!.vipUntil!.getTime() - Date.now()) / 86_400_000)).toBe(30);
    expect((await paymentOf(b.paymentId)).status).toBe('pending');
    await reconcilePaypal(db(), new Date(Date.now() + 4 * 3_600_000), pp.api);
    expect((await paymentOf(b.paymentId)).status).toBe('expired');
  });

  it('never delivers a different amount; a pending capture is delivered when PayPal completes it', async () => {
    const p = await newPlayer();
    const pp = fakePaypal();
    pp.control.captureValue = '0.01';
    const a = await createPaypalCheckout(db(), p.userId, { productId: 'tc_3200', consent: true }, pp.api, new Date(), ORIGIN);
    const orderA = (await paymentOf(a.paymentId)).orderId!;
    pp.approve(orderA);
    expect((await confirmPaypalOrder(db(), orderA, { userId: p.userId, api: pp.api }))!.status).toBe('failed');
    expect(await coinsOf(p.userId)).toBe(0);

    pp.control.captureValue = null;
    pp.control.captureStatus = 'PENDING';
    const b = await createPaypalCheckout(db(), p.userId, { productId: 'tc_100', consent: true }, pp.api, new Date(), ORIGIN);
    const orderB = (await paymentOf(b.paymentId)).orderId!;
    pp.approve(orderB);
    expect((await confirmPaypalOrder(db(), orderB, { userId: p.userId, api: pp.api }))!.status).toBe('pending');
    pp.orders.get(orderB)!.capture!.status = 'COMPLETED';
    await reconcilePaypal(db(), new Date(Date.now() + 2 * 60_000), pp.api);
    expect((await paymentOf(b.paymentId)).status).toBe('paid');
    expect(await coinsOf(p.userId)).toBe(100);
  });

  it('administrators refund through PayPal; the purchase is taken back once', async () => {
    const admin = await staff('admin');
    const support = await staff('support');
    const p = await newPlayer();
    const pp = fakePaypal();
    const { paymentId } = await createPaypalCheckout(db(), p.userId, { productId: 'tc_550', consent: true }, pp.api, new Date(), ORIGIN);
    const orderId = (await paymentOf(paymentId)).orderId!;
    pp.approve(orderId);
    await confirmPaypalOrder(db(), orderId, { api: pp.api });
    expect(await code(refundPaypalPayment(db(), support, paymentId, pp.api))).toBe('forbidden');
    expect(await refundPaypalPayment(db(), admin, paymentId, pp.api)).toBe(true);
    expect((await paymentOf(paymentId)).status).toBe('refunded');
    expect(await coinsOf(p.userId)).toBe(0);
    expect(await code(refundPaypalPayment(db(), admin, paymentId, pp.api))).toBe('not_refundable');
    expect(pp.control.refunds).toBe(1);
    const [audit] = await db().select().from(adminAudit).where(and(eq(adminAudit.action, 'refund_payment'), eq(adminAudit.targetUserId, p.userId)));
    expect(audit).toBeDefined();
  });

  it('webhooks must be configured and verified by PayPal; chargebacks take the purchase back, partial refunds do not', async () => {
    const p = await newPlayer();
    const pp = fakePaypal();
    const { paymentId } = await createPaypalCheckout(db(), p.userId, { productId: 'tc_550', consent: true }, pp.api, new Date(), ORIGIN);
    const orderId = (await paymentOf(paymentId)).orderId!;
    pp.approve(orderId);
    await confirmPaypalOrder(db(), orderId, { api: pp.api });
    const captureId = (await paymentOf(paymentId)).captureId!;
    const partial = { id: 'WH-1', event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { id: 'R1', amount: { currency_code: 'EUR', value: '1.00' }, links: [{ rel: 'up', href: `https://api.sandbox.paypal.com/v2/payments/captures/${captureId}` }] } };

    expect(await code(handlePaypalWebhook(db(), {}, partial, pp.api))).toBe('Error');
    process.env.PAYPAL_WEBHOOK_ID = 'WH-TEST';
    pp.control.verified = false;
    expect(await code(handlePaypalWebhook(db(), {}, partial, pp.api))).toBe('Error');
    pp.control.verified = true;
    expect(await handlePaypalWebhook(db(), {}, partial, pp.api)).toBe('partial_refund');
    expect(await coinsOf(p.userId)).toBe(550);
    const chargeback = { id: 'WH-2', event_type: 'PAYMENT.CAPTURE.REVERSED', resource: { id: captureId, amount: { currency_code: 'EUR', value: '9.99' } } };
    expect(await handlePaypalWebhook(db(), {}, chargeback, pp.api)).toBe('refunded');
    expect(await coinsOf(p.userId)).toBe(0);
    delete process.env.PAYPAL_WEBHOOK_ID;
  });
});

describe('secrets file from GitHub Secrets', () => {
  it('loads only the payment settings it knows', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tv-secrets-'));
    const file = path.join(dir, 'secrets.env');
    writeFileSync(file, 'PAYPAL_ENV=live\nSUPPORT_EMAIL=office@example.com\nDATABASE_URL=postgres://evil\n# comment\nPATH=/tmp\n');
    const before = { db: process.env.DATABASE_URL, path: process.env.PATH, env: process.env.PAYPAL_ENV, email: process.env.SUPPORT_EMAIL };
    expect(loadSecretsFile(file)).toBe(2);
    expect(process.env.PAYPAL_ENV).toBe('live');
    expect(process.env.DATABASE_URL).toBe(before.db);
    expect(process.env.PATH).toBe(before.path);
    expect(loadSecretsFile(path.join(dir, 'missing.env'))).toBe(0);
    process.env.SUPPORT_EMAIL = before.email;
    if (before.env === undefined) delete process.env.PAYPAL_ENV;
    else process.env.PAYPAL_ENV = before.env;
  });
});
