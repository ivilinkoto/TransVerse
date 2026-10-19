import { createVerify, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb } from '@/server/db/client';
import { coinEntries, payments, users } from '@/server/db/schema';
import { GameError } from '@/server/game/errors';
import { assetLinks, diagnoseGooglePlay, paymentConfig, PlayError, playServiceAccount, reconcileGooglePlay, verifyPlayPurchase, type PlayApi, type PlayPurchase } from '@/server/payments';
import { loadSecretsFile } from '@/server/secrets';
import { db, newPlayer } from './helpers';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SERVICE_ACCOUNT = JSON.stringify({ type: 'service_account', client_email: 'billing@transverse.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.googleapis.com/token' });
const ENV = { GOOGLE_PLAY_PACKAGE: 'com.transversebg.app', GOOGLE_PLAY_SERVICE_ACCOUNT: SERVICE_ACCOUNT, SELLER_NAME: 'Тест ЕООД', SUPPORT_EMAIL: 'help@example.com' };
beforeAll(() => Object.assign(process.env, ENV));
afterAll(async () => {
  for (const k of [...Object.keys(ENV), 'ANDROID_CERT_SHA256']) delete process.env[k];
  await closeDb();
});
afterEach(() => vi.unstubAllGlobals());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).name));
const coinsOf = async (userId: string) => (await db().select({ coins: users.coins }).from(users).where(eq(users.id, userId)))[0]!.coins;
const byToken = async (token: string) => (await db().select().from(payments).where(eq(payments.purchaseToken, token)))[0];

let n = 0;
const newToken = () => `play-token.${Date.now()}.${++n}-abcdef`;

/** Behaves like the Google Play Developer API for the calls we make. */
function fakePlay() {
  const purchases = new Map<string, PlayPurchase & { productId: string }>();
  const voided: { purchaseToken: string }[] = [];
  const control = { consumeFails: false, consumed: 0 };
  const api: PlayApi = {
    async getPurchase(productId, token) {
      const p = purchases.get(token);
      if (!p || p.productId !== productId) throw new PlayError(400, 'purchaseTokenDoesNotMatchProductId', 'invalid');
      return { ...p };
    },
    async consume(productId, token) {
      if (control.consumeFails) throw new PlayError(503, 'backendError', 'try later');
      const p = purchases.get(token)!;
      p.consumptionState = 1;
      control.consumed++;
    },
    async voided() {
      return { voidedPurchases: voided };
    },
  };
  const buy = (productId: string, extra: Partial<PlayPurchase> = {}) => {
    const token = newToken();
    purchases.set(token, { productId, purchaseState: 0, consumptionState: 0, orderId: `GPA.3398-${++n}`, ...extra });
    return token;
  };
  return { api, buy, purchases, voided, control };
}

describe('Google Play payments', () => {
  it('is on with the package, a valid service account and the seller details', () => {
    expect(paymentConfig().googlePlay).toMatchObject({ enabled: true, packageName: 'com.transversebg.app' });
    // Not a web provider: PayPal / Stripe buttons are separate.
    expect(paymentConfig().providers).not.toContain('google_play');
    expect(playServiceAccount()?.clientEmail).toBe('billing@transverse.iam.gserviceaccount.com');
    // The deploy turns line breaks into spaces; base64 works too.
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT = JSON.stringify(JSON.parse(SERVICE_ACCOUNT), null, 2).replace(/\n/g, ' ');
    expect(playServiceAccount()).not.toBeNull();
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT = Buffer.from(SERVICE_ACCOUNT).toString('base64');
    expect(playServiceAccount()).not.toBeNull();
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT = '{"client_email": "x"}';
    expect(paymentConfig().googlePlay.enabled).toBe(false);
    expect(paymentConfig().googlePlay.missing.join()).toContain('невалиден');
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT = SERVICE_ACCOUNT;
  });

  it('delivers a purchase once, to the player who sent it, and consumes it', async () => {
    const p = await newPlayer();
    const other = await newPlayer();
    const play = fakePlay();
    const token = play.buy('tc_550');
    const r = await verifyPlayPurchase(db(), p.userId, { productId: 'tc_550', purchaseToken: token, consent: true }, play.api);
    expect(r.status).toBe('paid');
    expect(await coinsOf(p.userId)).toBe(550);
    const row = (await byToken(token))!;
    expect(row).toMatchObject({ provider: 'google_play', status: 'paid', amountCents: 999, orderId: play.purchases.get(token)!.orderId });
    expect(row.consumedAt).not.toBeNull();
    expect(play.control.consumed).toBe(1);
    // Sent again (restore on start, double tap): nothing more.
    expect((await verifyPlayPurchase(db(), p.userId, { productId: 'tc_550', purchaseToken: token, consent: true }, play.api)).status).toBe('paid');
    expect(await coinsOf(p.userId)).toBe(550);
    expect(await db().select().from(coinEntries).where(eq(coinEntries.idempotencyKey, `payment:${row.id}`))).toHaveLength(1);
    // Someone else cannot claim the same token.
    expect(await code(verifyPlayPurchase(db(), other.userId, { productId: 'tc_550', purchaseToken: token, consent: true }, play.api))).toBe('purchase_taken');
    expect(await coinsOf(other.userId)).toBe(0);
  });

  it('two requests at once still deliver once', async () => {
    const p = await newPlayer();
    const play = fakePlay();
    const token = play.buy('tc_100');
    const input = { productId: 'tc_100', purchaseToken: token, consent: true as const };
    const results = await Promise.all([verifyPlayPurchase(db(), p.userId, input, play.api), verifyPlayPurchase(db(), p.userId, input, play.api)]);
    expect(results.map((r) => r.status)).toEqual(['paid', 'paid']);
    expect(await coinsOf(p.userId)).toBe(100);
  });

  it('refuses tokens Google does not confirm, other products, cancelled and used purchases; waits for pending ones', async () => {
    const p = await newPlayer();
    const play = fakePlay();
    expect(await code(verifyPlayPurchase(db(), p.userId, { productId: 'tc_100', purchaseToken: newToken(), consent: true }, play.api))).toBe('purchase_invalid');
    const cheap = play.buy('tc_100');
    expect(await code(verifyPlayPurchase(db(), p.userId, { productId: 'tc_3200', purchaseToken: cheap, consent: true }, play.api))).toBe('purchase_invalid');
    expect(await code(verifyPlayPurchase(db(), p.userId, { productId: 'tc_100', purchaseToken: play.buy('tc_100', { purchaseState: 1 }), consent: true }, play.api))).toBe('purchase_cancelled');
    expect(await code(verifyPlayPurchase(db(), p.userId, { productId: 'tc_100', purchaseToken: play.buy('tc_100', { consumptionState: 1 }), consent: true }, play.api))).toBe('purchase_used');
    const pending = play.buy('vip_30_direct', { purchaseState: 2 });
    expect(await verifyPlayPurchase(db(), p.userId, { productId: 'vip_30_direct', purchaseToken: pending, consent: true }, play.api)).toEqual({ paymentId: null, status: 'pending' });
    expect(await byToken(pending)).toBeUndefined();
    // Paid later: the next restore delivers it.
    play.purchases.get(pending)!.purchaseState = 0;
    expect((await verifyPlayPurchase(db(), p.userId, { productId: 'vip_30_direct', purchaseToken: pending, consent: true }, play.api)).status).toBe('paid');
    const [u] = await db().select({ vipUntil: users.vipUntil }).from(users).where(eq(users.id, p.userId));
    expect(Math.round((u!.vipUntil!.getTime() - Date.now()) / 86_400_000)).toBe(30);
    expect(await coinsOf(p.userId)).toBe(0);
    // Google unreachable: a clear message, nothing recorded (Play refunds an unconsumed purchase itself).
    const down: PlayApi = { ...play.api, getPurchase: async () => Promise.reject(new PlayError(503, 'backendError', 'down')) };
    const token = play.buy('tc_100');
    expect(await code(verifyPlayPurchase(db(), p.userId, { productId: 'tc_100', purchaseToken: token, consent: true }, down))).toBe('play_unavailable');
    expect(await byToken(token)).toBeUndefined();
  });

  it('records a licence tester purchase at zero', async () => {
    const p = await newPlayer();
    const play = fakePlay();
    const token = play.buy('tc_100', { purchaseType: 0 });
    await verifyPlayPurchase(db(), p.userId, { productId: 'tc_100', purchaseToken: token, consent: true }, play.api);
    expect(await byToken(token)).toMatchObject({ amountCents: 0, status: 'paid' });
    expect(await coinsOf(p.userId)).toBe(100);
  });

  it('the worker consumes what failed to consume and takes back refunded purchases', async () => {
    const p = await newPlayer();
    const play = fakePlay();
    play.control.consumeFails = true;
    const token = play.buy('tc_1200');
    await verifyPlayPurchase(db(), p.userId, { productId: 'tc_1200', purchaseToken: token, consent: true }, play.api);
    expect((await byToken(token))!.consumedAt).toBeNull();
    play.control.consumeFails = false;
    await reconcileGooglePlay(db(), new Date(), play.api);
    expect((await byToken(token))!.consumedAt).not.toBeNull();

    play.voided.push({ purchaseToken: token }, { purchaseToken: 'unknown-token-123' });
    expect((await reconcileGooglePlay(db(), new Date(), play.api)).refunded).toBe(1);
    expect((await byToken(token))!.status).toBe('refunded');
    expect(await coinsOf(p.userId)).toBe(0);
    // The list keeps the refund for 30 days: taken back once.
    expect((await reconcileGooglePlay(db(), new Date(), play.api)).refunded).toBe(0);
    expect(await coinsOf(p.userId)).toBe(0);
  });

  it('signs in to Google with the service account (JWT) and explains errors', async () => {
    let assertion = '';
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        assertion = new URLSearchParams(String(init?.body)).get('assertion')!;
        return new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }), { status: 200 });
      }
      expect(url).toContain('/applications/com.transversebg.app/purchases/voidedpurchases');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer ya29.test');
      return new Response(JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'no access' } }), { status: 403 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await diagnoseGooglePlay();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('няма права');
    const [header, payload, signature] = assertion.split('.');
    expect(JSON.parse(Buffer.from(payload!, 'base64url').toString())).toMatchObject({ iss: 'billing@transverse.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/androidpublisher' });
    expect(createVerify('RSA-SHA256').update(`${header}.${payload}`).verify(publicKey, Buffer.from(signature!, 'base64url'))).toBe(true);
  });

  it('publishes Digital Asset Links only with valid fingerprints', () => {
    process.env.ANDROID_CERT_SHA256 = 'not-a-fingerprint';
    expect(assetLinks()).toEqual([]);
    const fp = Array.from({ length: 32 }, (_, i) => (i * 7).toString(16).padStart(2, '0')).join(':');
    process.env.ANDROID_CERT_SHA256 = `${fp}, ${fp.toUpperCase()}`;
    expect(assetLinks()).toEqual([{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'com.transversebg.app', sha256_cert_fingerprints: [fp.toUpperCase(), fp.toUpperCase()] } }]);
  });

  it('the Google Play settings come from the secrets file like the others', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'tv-secrets-')), 'secrets.env');
    writeFileSync(file, `GOOGLE_PLAY_PACKAGE=com.transversebg.app\nANDROID_CERT_SHA256=AA:BB\nGOOGLE_PLAY_SERVICE_ACCOUNT=${SERVICE_ACCOUNT.replace(/\n/g, ' ')}\n`);
    expect(loadSecretsFile(file)).toBe(3);
    expect(playServiceAccount()).not.toBeNull();
  });
});
