/**
 * PayPal Checkout (Orders API v2). Works without a webhook, so it runs on the
 * current server address too:
 *
 * 1. We create a PayPal order with the server's price and send the player to PayPal.
 * 2. The player approves (PayPal account or card as a guest) and comes back.
 * 3. Our server captures the order with PayPal (server to server) and delivers
 *    only when PayPal reports the capture COMPLETED with exactly our amount.
 *
 * If the player closes the browser after approving, the worker finds the order
 * and captures it (reconcilePaypal). A signed webhook is used when configured
 * (needs HTTPS), mainly for refunds and chargebacks made in PayPal.
 */
import { and, eq, gte, isNotNull, lte } from 'drizzle-orm';
import type { Database } from '@/server/db/client';
import { adminAudit, payments } from '@/server/db/schema';
import { requireAdminRole, type Staff } from '@/server/admin';
import { fail } from '@/server/game/errors';
import { checkoutSchema, describeFailure, markPaymentFailed, paymentConfig, paypalMode, refundLocked, settlePaid, siteUrl, startPayment, toCents, type CheckoutInput, type Payment } from './common';

// ── API client ────────────────────────────────────────────────────────────

interface Money {
  currency_code: string;
  value: string;
}
export interface PayPalCapture {
  id: string;
  status: string; // COMPLETED | PENDING | DECLINED | FAILED | REFUNDED | PARTIALLY_REFUNDED
  amount?: Money;
  custom_id?: string;
}
export interface PayPalOrder {
  id: string;
  status: string; // CREATED | PAYER_ACTION_REQUIRED | APPROVED | COMPLETED | VOIDED
  links?: { rel: string; href: string }[];
  purchase_units?: { custom_id?: string; payments?: { captures?: PayPalCapture[] } }[];
}

export class PayPalError extends Error {
  constructor(
    readonly status: number,
    readonly issue: string | null,
    message: string,
    readonly debugId: string | null = null,
  ) {
    super(message);
  }
}

/** The calls we make (an interface so tests can pass a fake PayPal). */
export interface PayPalApi {
  createOrder(body: unknown, requestId: string): Promise<PayPalOrder>;
  captureOrder(orderId: string, requestId: string): Promise<PayPalOrder>;
  getOrder(orderId: string): Promise<PayPalOrder>;
  refundCapture(captureId: string, requestId: string): Promise<{ id: string; status: string }>;
  verifyWebhook(headers: Record<string, string | null>, event: unknown, webhookId: string): Promise<boolean>;
}

const API = { sandbox: 'https://api-m.sandbox.paypal.com', live: 'https://api-m.paypal.com' };

function realApi(): PayPalApi {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) fail('payments_disabled', 'Плащанията с PayPal още не са включени.', 503);
  const base = API[paypalMode()];
  let token: { value: string; until: number } | null = null;

  async function accessToken() {
    if (token && token.until > Date.now() + 60_000) return token.value;
    const res = await fetch(`${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new PayPalError(res.status, 'AUTHENTICATION_FAILED', `PayPal authentication failed (${res.status}, ${paypalMode()})`);
    const data = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: data.access_token, until: Date.now() + data.expires_in * 1000 };
    return token.value;
  }

  async function call<T>(method: string, path: string, body?: unknown, requestId?: string): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        ...(requestId ? { 'PayPal-Request-Id': requestId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await res.json().catch(() => ({}))) as T & { name?: string; message?: string; details?: { issue?: string }[]; debug_id?: string };
    if (!res.ok) throw new PayPalError(res.status, data.details?.[0]?.issue ?? data.name ?? null, `PayPal ${method} ${path} → ${res.status} ${data.name ?? ''} ${data.debug_id ?? ''}`, data.debug_id ?? null);
    return data;
  }

  return {
    createOrder: (body, requestId) => call('POST', '/v2/checkout/orders', body, requestId),
    captureOrder: (orderId, requestId) => call('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {}, requestId),
    getOrder: (orderId) => call('GET', `/v2/checkout/orders/${encodeURIComponent(orderId)}`),
    refundCapture: (captureId, requestId) => call('POST', `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {}, requestId),
    async verifyWebhook(headers, event, webhookId) {
      const result = await call<{ verification_status: string }>('POST', '/v1/notifications/verify-webhook-signature', {
        auth_algo: headers['paypal-auth-algo'],
        cert_url: headers['paypal-cert-url'],
        transmission_id: headers['paypal-transmission-id'],
        transmission_sig: headers['paypal-transmission-sig'],
        transmission_time: headers['paypal-transmission-time'],
        webhook_id: webhookId,
        webhook_event: event,
      });
      return result.verification_status === 'SUCCESS';
    },
  };
}

let cached: PayPalApi | null = null;
export const paypalApi = (): PayPalApi => (cached ??= realApi());

const amount = (cents: number): Money => ({ currency_code: 'EUR', value: (cents / 100).toFixed(2) });

/**
 * Admin check: can we log in to PayPal with the configured keys, and in which
 * environment? When the configured one fails, the other one is tried too, so a
 * sandbox/live mix-up is named directly. Only access tokens are requested.
 */
export async function diagnosePaypal(fetcher: typeof fetch = fetch) {
  const id = process.env.PAYPAL_CLIENT_ID?.trim();
  const secret = process.env.PAYPAL_CLIENT_SECRET?.trim();
  const mode = paypalMode();
  if (!id || !secret) return { mode, ok: false, message: 'Липсват PAYPAL_CLIENT_ID или PAYPAL_CLIENT_SECRET.' };
  const tryLogin = async (m: 'live' | 'sandbox') => {
    try {
      const res = await fetcher(`${API[m]}/v1/oauth2/token`, {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
        signal: AbortSignal.timeout(15_000),
      });
      return res.status;
    } catch {
      return 0;
    }
  };
  const status = await tryLogin(mode);
  if (status === 200) return { mode, ok: true, message: `Връзката с PayPal (${mode}) работи — ключовете са верни.` };
  if (status === 0) return { mode, ok: false, message: 'Сървърът не успя да се свърже с PayPal (мрежа). Опитайте отново.' };
  const other = mode === 'live' ? 'sandbox' : 'live';
  if ((await tryLogin(other)) === 200) {
    return { mode, ok: false, message: `Ключовете са за ${other}, а PAYPAL_ENV е „${mode}“. ${other === 'live' ? 'Задайте PAYPAL_ENV=live' : 'Сложете Live ключовете (Client ID и Secret от раздел Live) или задайте PAYPAL_ENV=sandbox'} и пуснете Deploy.` };
  }
  return { mode, ok: false, message: `PayPal отхвърли ключовете (HTTP ${status}) и в live, и в sandbox. Проверете дали Client ID и Secret са копирани изцяло, без интервали, от едно и също приложение.` };
}

// ── Checkout ──────────────────────────────────────────────────────────────

/** Records a pending payment and creates the PayPal order; returns PayPal's approval page. */
export async function createPaypalCheckout(db: Database, userId: string, raw: CheckoutInput, api?: PayPalApi, now = new Date(), origin?: string | null) {
  const input = checkoutSchema.parse({ ...raw, provider: 'paypal' });
  if (!paymentConfig().paypal.enabled) fail('payments_disabled', 'Плащанията с PayPal още не са включени.', 503);
  const base = siteUrl(origin);
  const { payment, product } = await startPayment(db, userId, input, now);
  let order: PayPalOrder;
  try {
    order = await (api ?? paypalApi()).createOrder(
      {
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: payment.id,
            custom_id: payment.id,
            invoice_id: payment.id,
            description: `TransVerse · ${product.label}`,
            soft_descriptor: 'TRANSVERSE',
            amount: { ...amount(product.priceCents), breakdown: { item_total: amount(product.priceCents) } },
            items: [{ name: `TransVerse · ${product.label}`, description: product.description, sku: product.id, quantity: '1', category: 'DIGITAL_GOODS', unit_amount: amount(product.priceCents) }],
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: 'TransVerse',
              shipping_preference: 'NO_SHIPPING',
              user_action: 'PAY_NOW',
              return_url: `${base}/game/shop/payment?provider=paypal`,
              cancel_url: `${base}/game/shop?payment=cancelled`,
            },
          },
        },
      },
      `order:${payment.id}`,
    );
  } catch (error) {
    console.error('[payments] paypal order failed', error);
    await markPaymentFailed(db, payment.id, describeFailure(error));
    fail('checkout_failed', 'Плащането не можа да започне. Опитайте отново по-късно.', 502);
  }
  const url = order!.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href;
  await db.update(payments).set({ orderId: order!.id }).where(eq(payments.id, payment.id));
  if (!url) fail('checkout_failed', 'Плащането не можа да започне. Опитайте отново.', 502);
  return { paymentId: payment.id, url: url! };
}

// ── Confirmation ──────────────────────────────────────────────────────────

/** Applies what PayPal says about an order. Delivers only a COMPLETED capture of exactly our amount; safe to repeat. */
export async function applyPaypalOrder(db: Database, order: PayPalOrder, now = new Date()) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.orderId, order.id)).for('update');
    if (!p) return 'unknown' as const;
    if (p.status !== 'pending') return p.status;
    const unit = order.purchase_units?.[0];
    if (unit?.custom_id && unit.custom_id !== p.id) {
      console.error('[payments] paypal order does not belong to payment', { order: order.id, payment: p.id });
      return 'pending' as const;
    }
    const capture = unit?.payments?.captures?.[0];
    if (capture?.status === 'COMPLETED') return settlePaid(tx, p, { amountCents: toCents(capture.amount?.value), currency: capture.amount?.currency_code ?? null }, { captureId: capture.id }, now);
    if (capture && (capture.status === 'DECLINED' || capture.status === 'FAILED')) {
      await tx.update(payments).set({ status: 'failed', captureId: capture.id }).where(eq(payments.id, p.id));
      return 'failed' as const;
    }
    if (capture && capture.id !== p.captureId) await tx.update(payments).set({ captureId: capture.id }).where(eq(payments.id, p.id));
    if (!capture && order.status === 'VOIDED') {
      await tx.update(payments).set({ status: 'failed' }).where(eq(payments.id, p.id));
      return 'failed' as const;
    }
    return 'pending' as const;
  });
}

/**
 * Captures an approved order and applies the result. Called from the return
 * page (for the buyer only), the worker and the webhook. PayPal-Request-Id makes
 * a repeated capture return the first result instead of charging twice.
 */
export async function confirmPaypalOrder(db: Database, orderId: string, options: { userId?: string; api?: PayPalApi; now?: Date } = {}): Promise<Payment | null> {
  const where = options.userId ? and(eq(payments.orderId, orderId), eq(payments.userId, options.userId)) : eq(payments.orderId, orderId);
  const [p] = await db.select().from(payments).where(where);
  if (!p) return null;
  if (p.status === 'pending') {
    const api = options.api ?? paypalApi();
    try {
      let order: PayPalOrder;
      try {
        order = await api.captureOrder(orderId, `capture:${p.id}`);
      } catch (error) {
        if (!(error instanceof PayPalError)) throw error;
        if (error.issue === 'ORDER_ALREADY_CAPTURED') order = await api.getOrder(orderId);
        else if (error.issue === 'ORDER_NOT_APPROVED') order = await api.getOrder(orderId);
        else if (error.status === 422) {
          // e.g. the card or PayPal balance was declined — the buyer can start again.
          console.warn('[payments] paypal capture refused', error.issue, error.message);
          await markPaymentFailed(db, p.id, describeFailure(error));
          order = { id: orderId, status: 'FAILED' };
        } else throw error;
      }
      await applyPaypalOrder(db, order, options.now);
    } catch (error) {
      // Network or PayPal outage: stays pending, the worker tries again.
      console.error('[payments] paypal capture failed', error);
    }
  }
  const [fresh] = await db.select().from(payments).where(eq(payments.id, p.id));
  return fresh!;
}

/**
 * Worker: finishes orders the buyer approved but never came back from, picks up
 * captures that were pending, and expires abandoned ones.
 */
export async function reconcilePaypal(db: Database, now = new Date(), api?: PayPalApi) {
  const stale = await db
    .select()
    .from(payments)
    .where(and(eq(payments.provider, 'paypal'), eq(payments.status, 'pending'), lte(payments.createdAt, new Date(now.getTime() - 60_000)), gte(payments.createdAt, new Date(now.getTime() - 3 * 86_400_000))))
    .limit(50);
  let done = 0;
  for (const p of stale) {
    if (!p.orderId) {
      if (now.getTime() - p.createdAt.getTime() > 3_600_000) await markPaymentFailed(db, p.id);
      continue;
    }
    try {
      const order = await (api ?? paypalApi()).getOrder(p.orderId);
      if (order.status === 'APPROVED') await confirmPaypalOrder(db, p.orderId, { api, now });
      else if (order.status === 'COMPLETED' || order.status === 'VOIDED') await applyPaypalOrder(db, order, now);
      else if (now.getTime() - p.createdAt.getTime() > 3 * 3_600_000) await db.update(payments).set({ status: 'expired' }).where(and(eq(payments.id, p.id), eq(payments.status, 'pending')));
      done++;
    } catch (error) {
      if (error instanceof PayPalError && error.status === 404) await db.update(payments).set({ status: 'expired' }).where(and(eq(payments.id, p.id), eq(payments.status, 'pending')));
      else console.error('[payments] paypal reconcile failed', p.id, error);
    }
  }
  return done;
}

// ── Refunds ───────────────────────────────────────────────────────────────

/** Administrator refunds a PayPal payment in full; the coins / VIP days are taken back. */
export async function refundPaypalPayment(db: Database, actor: Staff, paymentId: string, api?: PayPalApi, now = new Date()) {
  requireAdminRole(actor);
  const [p] = await db.select().from(payments).where(eq(payments.id, paymentId));
  if (!p) fail('payment_not_found', 'Плащането не е намерено.', 404);
  if (p!.provider !== 'paypal') fail('wrong_provider', p!.provider === 'google_play' ? 'Това плащане се възстановява от Google Play Console (Поръчки) — ТрансКоин / VIP се премахват автоматично.' : 'Това плащане се възстановява от таблото на Stripe.');
  if (p!.status !== 'paid' || !p!.captureId) fail('not_refundable', 'Може да се възстанови само платено плащане.');
  let refund: { id: string; status: string };
  try {
    refund = await (api ?? paypalApi()).refundCapture(p!.captureId!, `refund:${p!.id}`);
  } catch (error) {
    console.error('[payments] paypal refund failed', error);
    fail('refund_failed', 'PayPal отказа възстановяването. Опитайте от сайта на PayPal.', 502);
  }
  if (refund!.status !== 'COMPLETED' && refund!.status !== 'PENDING') fail('refund_failed', `PayPal върна статус ${refund!.status}.`, 502);
  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for('update');
    const changed = await refundLocked(tx, locked!, now);
    await tx.insert(adminAudit).values({ actorId: actor.id, action: 'refund_payment', targetUserId: locked!.userId, details: { paymentId, amountCents: locked!.amountCents, provider: 'paypal', refundId: refund!.id } });
    return changed;
  });
}

// ── Webhook (optional, needs HTTPS) ───────────────────────────────────────

interface PayPalEvent {
  id: string;
  event_type: string;
  resource: { id?: string; status?: string; amount?: Money; supplementary_data?: { related_ids?: { order_id?: string } }; links?: { rel: string; href: string }[] };
}

/** Verifies the event with PayPal and applies it. Returns what happened (for the log). */
export async function handlePaypalWebhook(db: Database, headers: Record<string, string | null>, event: PayPalEvent, api?: PayPalApi, now = new Date()) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new PayPalError(400, 'NO_WEBHOOK_ID', 'PayPal webhook is not configured');
  const client = api ?? paypalApi();
  if (!(await client.verifyWebhook(headers, event, webhookId))) throw new PayPalError(400, 'BAD_SIGNATURE', 'PayPal webhook signature is not valid');
  const r = event.resource;
  switch (event.event_type) {
    case 'CHECKOUT.ORDER.APPROVED':
      if (r.id) await confirmPaypalOrder(db, r.id, { api: client, now });
      return 'approved';
    case 'PAYMENT.CAPTURE.COMPLETED':
    case 'PAYMENT.CAPTURE.PENDING':
    case 'PAYMENT.CAPTURE.DENIED': {
      // Never trust the payload alone: read the order back from PayPal.
      const orderId = r.supplementary_data?.related_ids?.order_id;
      if (orderId) await applyPaypalOrder(db, await client.getOrder(orderId), now);
      return 'capture';
    }
    case 'PAYMENT.CAPTURE.REFUNDED':
    case 'PAYMENT.CAPTURE.REVERSED': {
      // REFUNDED: the resource is the refund (its "up" link is the capture). REVERSED: the capture itself (chargeback).
      const captureId = event.event_type === 'PAYMENT.CAPTURE.REVERSED' ? r.id : r.links?.find((l) => l.rel === 'up')?.href.split('/').pop();
      if (!captureId) return 'ignored';
      return db.transaction(async (tx) => {
        const [p] = await tx.select().from(payments).where(and(eq(payments.captureId, captureId), isNotNull(payments.captureId))).for('update');
        if (!p) return 'unknown';
        // Partial refunds keep the purchase; only a full refund or a chargeback takes it back.
        if (event.event_type === 'PAYMENT.CAPTURE.REFUNDED' && toCents(r.amount?.value) !== p.amountCents) {
          console.warn('[payments] partial paypal refund — purchase kept', { payment: p.id, refunded: r.amount?.value });
          return 'partial_refund';
        }
        await refundLocked(tx, p, now);
        return 'refunded';
      });
    }
    default:
      return 'ignored';
  }
}
