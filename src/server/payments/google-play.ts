/**
 * Google Play Billing for the Android app (a Trusted Web Activity around the
 * site). Inside the app the player pays through Google Play — card, Google Pay
 * balance or, where the operator supports it, the phone bill:
 *
 * 1. The page asks Play for the purchase (Digital Goods API + PaymentRequest)
 *    and sends us the purchase token.
 * 2. Our server reads the purchase back from the Google Play Developer API
 *    (server to server, with a service account) and delivers only a purchase
 *    of that very product in state "purchased". A token is delivered once.
 * 3. The purchase is consumed, so it can be bought again. Play refunds a
 *    purchase that is not consumed/acknowledged within 3 days, so a purchase we
 *    could not deliver is returned to the buyer by Play itself.
 *
 * Refunds and chargebacks made in Google Play reach us through the voided
 * purchases list, read by the worker.
 */
import { createSign } from 'node:crypto';
import { and, eq, gte, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { paidProduct } from '@/lib/game/payments';
import type { Database } from '@/server/db/client';
import { payments } from '@/server/db/schema';
import { fail } from '@/server/game/errors';
import { assertCanBuy, deliverPayment, paymentConfig, playServiceAccount, refundLocked, type Payment } from './common';

// ── API client ────────────────────────────────────────────────────────────

/** A one-time product purchase as the Developer API returns it (purchases.products.get). */
export interface PlayPurchase {
  productId?: string;
  /** 0 purchased · 1 cancelled · 2 pending (e.g. paid later in cash). */
  purchaseState?: number;
  /** 0 not consumed yet · 1 consumed. */
  consumptionState?: number;
  orderId?: string;
  /** Absent for real money; 0 = a licence tester's test purchase, 1 promo code, 2 rewarded. */
  purchaseType?: number;
  regionCode?: string;
}

export interface PlayVoided {
  purchaseToken: string;
  orderId?: string;
  voidedTimeMillis?: string;
}

export class PlayError extends Error {
  constructor(
    readonly status: number,
    readonly issue: string | null,
    message: string,
  ) {
    super(message);
  }
}

/** The calls we make (an interface so tests can pass a fake Google Play). */
export interface PlayApi {
  getPurchase(productId: string, token: string): Promise<PlayPurchase>;
  consume(productId: string, token: string): Promise<void>;
  voided(startTimeMillis: number, pageToken?: string): Promise<{ voidedPurchases?: PlayVoided[]; tokenPagination?: { nextPageToken?: string } }>;
}

const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
const b64url = (data: string | Buffer) => Buffer.from(data).toString('base64url');

function realApi(): PlayApi {
  const account = playServiceAccount();
  const pkg = process.env.GOOGLE_PLAY_PACKAGE?.trim();
  if (!account || !pkg) fail('payments_disabled', 'Плащанията през Google Play още не са включени.', 503);
  let token: { value: string; until: number } | null = null;

  /** OAuth 2.0 for a service account: a JWT signed with its key, exchanged for an access token. */
  async function accessToken() {
    if (token && token.until > Date.now() + 60_000) return token.value;
    const iat = Math.floor(Date.now() / 1000);
    const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: account!.clientEmail, scope: SCOPE, aud: account!.tokenUri, iat, exp: iat + 3600 }))}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(account!.privateKey);
    const res = await fetch(account!.tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(signature)}` }),
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !data.access_token) throw new PlayError(res.status, `auth:${data.error ?? 'failed'}`, `Google authentication failed (${res.status} ${data.error ?? ''})`);
    token = { value: data.access_token, until: Date.now() + (data.expires_in ?? 3600) * 1000 };
    return token.value;
  }

  async function call<T>(method: string, path: string): Promise<T> {
    const res = await fetch(`${API}/${encodeURIComponent(pkg!)}${path}`, { method, headers: { Authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    const data = (text ? JSON.parse(text) : {}) as T & { error?: { code?: number; status?: string; message?: string; errors?: { reason?: string }[] } };
    if (!res.ok) throw new PlayError(res.status, data.error?.errors?.[0]?.reason ?? data.error?.status ?? null, `Google Play ${method} ${path.split('/tokens/')[0]} → ${res.status} ${data.error?.message ?? ''}`);
    return data;
  }

  const purchasePath = (productId: string, t: string) => `/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(t)}`;
  return {
    getPurchase: (productId, t) => call('GET', purchasePath(productId, t)),
    consume: async (productId, t) => {
      await call('POST', `${purchasePath(productId, t)}:consume`);
    },
    voided: (startTimeMillis, pageToken) => call('GET', `/purchases/voidedpurchases?startTime=${startTimeMillis}${pageToken ? `&token=${encodeURIComponent(pageToken)}` : ''}`),
  };
}

let cached: PlayApi | null = null;
export const playApi = (): PlayApi => (cached ??= realApi());

// ── Verification and delivery ─────────────────────────────────────────────

export const playPurchaseSchema = z.object({
  productId: z.string().max(40),
  purchaseToken: z.string().min(10).max(4096).regex(/^[\w.:-]+$/, 'Невалидна покупка.'),
  /** EU: the buyer agreed that delivery starts at once (the same notice as on the web). */
  consent: z.literal(true, { error: 'Потвърдете, че желаете доставката да започне веднага.' }),
});

/**
 * The page sends a purchase token after Play took the money (or when it finds
 * an unfinished purchase on start). Delivers it once, to the first player
 * who sends it, and consumes it. Returns the payment status.
 */
export async function verifyPlayPurchase(db: Database, userId: string, raw: z.input<typeof playPurchaseSchema>, api?: PlayApi, now = new Date()) {
  const input = playPurchaseSchema.parse(raw);
  if (!paymentConfig().googlePlay.enabled) fail('payments_disabled', 'Плащанията през Google Play още не са включени.', 503);
  const product = paidProduct(input.productId);
  if (!product) fail('unknown_product', 'Непознат продукт.');
  const client = api ?? playApi();

  const known = async () => (await db.select().from(payments).where(eq(payments.purchaseToken, input.purchaseToken)))[0];
  const answer = async (p: Payment) => {
    if (p.userId !== userId) fail('purchase_taken', 'Тази покупка вече е добавена към друг профил.', 409);
    if (p.status === 'paid' && !p.consumedAt) await consumePlay(db, p, client, now);
    return { paymentId: p.id, status: p.status };
  };
  const existing = await known();
  if (existing) return answer(existing);

  // Not delivered: Play keeps the purchase unconsumed and refunds it after 3 days.
  await assertCanBuy(db, userId);
  let purchase: PlayPurchase;
  try {
    purchase = await client.getPurchase(product!.id, input.purchaseToken);
  } catch (error) {
    if (error instanceof PlayError && !error.issue?.startsWith('auth:') && (error.status === 400 || error.status === 404 || error.status === 410)) fail('purchase_invalid', 'Google Play не потвърди тази покупка.');
    console.error('[payments] google play check failed', error);
    fail('play_unavailable', 'Google Play не отговаря в момента. Покупката ще бъде добавена автоматично при следващото отваряне на магазина.', 502);
  }
  if (purchase!.productId && purchase!.productId !== product!.id) fail('purchase_invalid', 'Покупката е за друг продукт.');
  if (purchase!.purchaseState === 2) return { paymentId: null, status: 'pending' as const };
  if (purchase!.purchaseState !== 0) fail('purchase_cancelled', 'Покупката е отказана в Google Play — нищо не е таксувано.');
  if (purchase!.consumptionState === 1) {
    // Delivered and consumed by a parallel request a moment ago?
    const delivered = await known();
    if (delivered) return answer(delivered);
    fail('purchase_used', 'Тази покупка вече е използвана.', 409);
  }

  const test = purchase!.purchaseType === 0;
  const created = await db.transaction(async (tx) => {
    const [p] = await tx
      .insert(payments)
      .values({
        userId,
        provider: 'google_play',
        productId: product!.id,
        coins: product!.coins,
        vipDays: product!.vipDays,
        // The buyer pays the local price set in Play Console; we record the list price (0 for a licence tester's test purchase).
        amountCents: test ? 0 : product!.priceCents,
        currency: 'eur',
        status: 'paid',
        purchaseToken: input.purchaseToken,
        orderId: purchase!.orderId ?? null,
        failureReason: test ? 'тестова покупка (Google Play)' : null,
        consentAt: now,
        createdAt: now,
        paidAt: now,
      })
      .onConflictDoNothing({ target: payments.purchaseToken })
      .returning();
    if (p) await deliverPayment(tx, p, now);
    return p ?? null;
  });
  // Sent twice at once: the other request delivered it.
  if (!created) return answer((await known())!);
  await consumePlay(db, created, client, now);
  return { paymentId: created.id, status: 'paid' as const };
}

/** Consumes a delivered purchase (so it can be bought again); the worker retries failures. */
export async function consumePlay(db: Database, p: Payment, api: PlayApi, now = new Date()) {
  if (!p.purchaseToken || p.consumedAt) return true;
  try {
    await api.consume(p.productId, p.purchaseToken);
  } catch (error) {
    // Already consumed (e.g. an earlier try that timed out): read it back.
    const state = await api.getPurchase(p.productId, p.purchaseToken).catch(() => null);
    if (state?.consumptionState !== 1) {
      console.error('[payments] google play consume failed', p.id, error);
      return false;
    }
  }
  await db.update(payments).set({ consumedAt: now }).where(eq(payments.id, p.id));
  return true;
}

/**
 * Worker: consumes delivered purchases that are not consumed yet, and takes
 * back purchases refunded or charged back in Google Play (voided purchases,
 * last 30 days).
 */
export async function reconcileGooglePlay(db: Database, now = new Date(), api?: PlayApi) {
  const client = api ?? playApi();
  const unconsumed = await db
    .select()
    .from(payments)
    .where(and(eq(payments.provider, 'google_play'), eq(payments.status, 'paid'), isNull(payments.consumedAt), gte(payments.createdAt, new Date(now.getTime() - 3 * 86_400_000))))
    .limit(50);
  for (const p of unconsumed) await consumePlay(db, p, client, now);

  let refunded = 0;
  let page: string | undefined;
  for (let i = 0; i < 10; i++) {
    const res = await client.voided(now.getTime() - 30 * 86_400_000, page);
    for (const v of res.voidedPurchases ?? []) {
      const changed = await db.transaction(async (tx) => {
        const [p] = await tx.select().from(payments).where(and(eq(payments.purchaseToken, v.purchaseToken), eq(payments.provider, 'google_play'))).for('update');
        return p ? refundLocked(tx, p, now) : false;
      });
      if (changed) refunded++;
    }
    page = res.tokenPagination?.nextPageToken;
    if (!page) break;
  }
  return { consumed: unconsumed.length, refunded };
}

/**
 * Admin check: can we sign in with the service account, and may it read this
 * app's purchases? (reads the voided purchases list — nothing is changed)
 */
export async function diagnoseGooglePlay(api?: PlayApi) {
  const config = paymentConfig().googlePlay;
  if (!config.enabled) return { ok: false, message: `Липсват: ${config.missing.join(', ')}.` };
  try {
    await (api ?? playApi()).voided(Date.now() - 86_400_000);
    return { ok: true, message: `Връзката с Google Play работи — сметката има достъп до покупките на ${config.packageName}.` };
  } catch (error) {
    if (!(error instanceof PlayError)) return { ok: false, message: 'Сървърът не успя да се свърже с Google (мрежа). Опитайте отново.' };
    if (error.issue?.startsWith('auth:')) return { ok: false, message: 'Google отхвърли ключа на service account-а. Свалете нов JSON ключ и го сложете в GOOGLE_PLAY_SERVICE_ACCOUNT.' };
    if (error.status === 401 || error.status === 403) return { ok: false, message: 'Service account-ът няма права в Play Console. Поканете го в „Потребители и разрешения“ с право „Преглед на финансови данни“ и „Управление на поръчки“ (промяната влиза в сила до 24 ч).' };
    if (error.status === 404) return { ok: false, message: `Приложението ${config.packageName} не е намерено в Play Console — проверете GOOGLE_PLAY_PACKAGE.` };
    return { ok: false, message: `Google Play върна грешка (HTTP ${error.status}${error.issue ? `, ${error.issue}` : ''}).` };
  }
}

/** Digital Asset Links for the Android app: lets it open the site full screen (no address bar). */
export function assetLinks() {
  const pkg = process.env.GOOGLE_PLAY_PACKAGE?.trim();
  const fingerprints = (process.env.ANDROID_CERT_SHA256 ?? '')
    .split(/[\s,]+/)
    .map((f) => f.trim().toUpperCase())
    .filter((f) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f));
  if (!pkg || !fingerprints.length) return [];
  return [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: fingerprints } }];
}
