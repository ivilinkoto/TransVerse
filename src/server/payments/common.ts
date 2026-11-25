/**
 * Real-money purchases — the parts every provider shares: configuration,
 * pending payments, delivery and refunds. Providers (PayPal, Stripe) only
 * confirm that money arrived; delivery always goes through here, exactly once.
 */
import { premiumPassOpen } from '@/server/game/season-pass';
import { refreshVipLevel } from '@/server/game/vip-levels';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { euro, giftable, paidProduct } from '@/lib/game/payments';
import { isBlackFriday } from '@/lib/game/prewinter';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { payments, users } from '@/server/db/schema';
import { postCoins } from '@/server/game/coins';
import { fail } from '@/server/game/errors';
import { notify } from '@/server/game/notify';
import { mailConfig } from '@/server/mail';
import { t } from '@/i18n/t';
import { featureFor } from '@/server/features';
import { deliverExtras, levelOfferOf, refundExtras, starterPackOpen, supporterPackOpen } from '@/server/game/shop-v2';

export type Payment = typeof payments.$inferSelect;
export type Provider = 'paypal' | 'stripe';

/** What may take money right now. Secrets stay on the server; only flags reach the page. */
export function paymentConfig() {
  const env = process.env;
  const sellerMissing = [!env.SELLER_NAME && 'SELLER_NAME', !env.SUPPORT_EMAIL && 'SUPPORT_EMAIL'].filter((x): x is string => !!x);
  const paypalMissing = [!env.PAYPAL_CLIENT_ID && 'PAYPAL_CLIENT_ID', !env.PAYPAL_CLIENT_SECRET && 'PAYPAL_CLIENT_SECRET'].filter((x): x is string => !!x);
  const stripeMissing = [!env.STRIPE_SECRET_KEY && 'STRIPE_SECRET_KEY', !env.STRIPE_WEBHOOK_SECRET && 'STRIPE_WEBHOOK_SECRET'].filter((x): x is string => !!x);
  const paypal = { enabled: !sellerMissing.length && !paypalMissing.length, sandbox: paypalMode() === 'sandbox', webhook: !!env.PAYPAL_WEBHOOK_ID, missing: [...sellerMissing, ...paypalMissing] };
  const stripe = { enabled: !sellerMissing.length && !stripeMissing.length, testMode: env.STRIPE_SECRET_KEY?.startsWith('sk_test_') ?? false, missing: [...sellerMissing, ...stripeMissing] };
  const providers = [paypal.enabled && ('paypal' as const), stripe.enabled && ('stripe' as const)].filter((x): x is Provider => !!x);
  return {
    enabled: providers.length > 0,
    providers,
    paypal,
    stripe,
    /** Test money only (PayPal sandbox / Stripe test keys). */
    testMode: (paypal.enabled && paypal.sandbox) || (stripe.enabled && stripe.testMode),
    /** APP_URL is set but is not a full address (it is then ignored). */
    appUrlInvalid: !!env.APP_URL && !validAppUrl(env.APP_URL),
    seller: { name: env.SELLER_NAME ?? '', id: env.SELLER_ID ?? '', address: env.SELLER_ADDRESS ?? '', email: env.SUPPORT_EMAIL ?? '' },
  };
}

export const checkoutSchema = z.object({
  productId: z.string().max(40),
  provider: z.enum(['paypal', 'stripe']).default('paypal'),
  /** EU: the buyer agrees that delivery starts at once and the right of withdrawal ends. */
  consent: z.literal(true, { error: 'Потвърдете, че желаете доставката да започне веднага.' }),
  /** 1.3.2.2: buy a ТрансКоин pack for this player (username). */
  giftTo: z.string().trim().max(40).optional(),
});
export type CheckoutInput = z.input<typeof checkoutSchema>;

/** PayPal environment; anything but "live" (any case, spaces ignored) means sandbox. */
export function paypalMode(): 'live' | 'sandbox' {
  return process.env.PAYPAL_ENV?.trim().toLowerCase() === 'live' ? 'live' : 'sandbox';
}

const validAppUrl = (url: string) => /^https?:\/\/[^\s/]+(\/.*)?$/i.test(url.trim());

/** Public address for return pages: APP_URL when it is a full address, else the (same-origin checked) address the player used. */
export function siteUrl(requestOrigin?: string | null): string {
  const configured = process.env.APP_URL?.trim();
  const base = configured && validAppUrl(configured) ? configured : requestOrigin;
  if (!base) fail('payments_disabled', t('Липсва адресът на сайта (APP_URL).'), 503);
  return base!.replace(/\/$/, '');
}

/** Validates the order and records a pending payment with the server's own price. */
export async function startPayment(db: Database, userId: string, input: z.output<typeof checkoutSchema>, now: Date) {
  const product = paidProduct(input.productId);
  if (!product) fail('unknown_product', t('Непознат продукт.'));
  const [user] = await db.select({ email: users.email, bannedAt: users.bannedAt, verified: users.emailVerifiedAt, level: users.level }).from(users).where(eq(users.id, userId));
  if (!user || user.bannedAt) fail('forbidden', t('Профилът не може да прави покупки.'), 403);
  // 1.2.3: the starter pack and the monthly card come with the new shop; the starter pack once per account.
  if (product!.v2 && !(await featureFor(db, userId, 'shop_v2', now))) fail('not_released', t('Това идва със следващото обновление.'), 403);
  if (product!.id === 'supporter_pack' && !(await featureFor(db, userId, 'supporter_pack', now) && (await supporterPackOpen(db, userId, now)))) fail('supporter_used', t('„Подкрепи TransVerse“ е веднъж за профил, до края на 2026 г.'), 409);
  if (product!.id === 'starter_pack' && !(await starterPackOpen(db, userId, user!.level))) fail('starter_used', t('Началният пакет е веднъж за профил, от ниво 3.'), 409);
  if (product!.feature && !(await featureFor(db, userId, product!.feature, now))) fail('not_released', t('Това идва със следващото обновление.'), 403);
  if ((product!.id === 'pass_premium' || product!.id === 'pass_plus') && !(await premiumPassOpen(db, userId, now))) fail('already_premium', t('Вече имаш премиум пропуска за този сезон.'), 409);
  if (product!.id === 'level_offer' && !(await levelOfferOf(db, userId, now))) fail('offer_closed', t('Офертата за ниво е изтекла или вече е купена.'), 409);
  if (product!.id === 'black_friday_pack' && !isBlackFriday(now)) fail('not_in_season', t('Пакетът „Черен петък“ се продава само от 27 до 30 ноември.'), 409);
  // 1.3.2.2: a ТрансКоин pack for another player.
  let giftUserId: string | null = null;
  if (input.giftTo) {
    if (!(await featureFor(db, userId, 'gift_tc', now))) fail('not_released', t('Това идва със следващото обновление.'), 403);
    if (!giftable(product!)) fail('not_giftable', t('Само пакетите с ТрансКоин могат да се подаряват.'));
    const [to] = await db.select({ id: users.id, bannedAt: users.bannedAt }).from(users).where(sql`lower(${users.username}) = lower(${input.giftTo})`);
    if (!to || to.bannedAt) fail('recipient_not_found', t('Няма такъв играч.'), 404);
    if (to!.id === userId) fail('gift_self', t('Не можеш да подариш на себе си.'));
    giftUserId = to!.id;
  }
  // With e-mail switched on, purchases need a confirmed address (receipts, account recovery).
  if (mailConfig().enabled && !user!.verified) fail('email_unverified', t('Първо потвърди имейла си — линкът е в пощата ти (или го изпрати отново от „Профил и настройки“).'), 403);
  // At most a few unfinished checkouts at a time (stops spamming the provider).
  const [{ open = 0 } = {}] = await db
    .select({ open: sql<number>`count(*)::int` })
    .from(payments)
    .where(and(eq(payments.userId, userId), eq(payments.status, 'pending'), sql`${payments.createdAt} > ${new Date(now.getTime() - 3_600_000)}`));
  if (open >= 5) fail('too_many_checkouts', t('Имате няколко незавършени плащания. Опитайте отново след малко.'), 429);
  const [payment] = await db
    .insert(payments)
    .values({ userId, provider: input.provider, productId: product!.id, coins: product!.coins, vipDays: product!.vipDays, amountCents: product!.priceCents, currency: 'eur', consentAt: now, giftUserId })
    .returning();
  return { payment: payment!, product: product!, email: user!.email };
}

export async function markPaymentFailed(db: DbOrTx, paymentId: string, reason?: string) {
  await db
    .update(payments)
    .set({ status: 'failed', ...(reason ? { failureReason: reason.slice(0, 300) } : {}) })
    .where(and(eq(payments.id, paymentId), eq(payments.status, 'pending')));
}

/** A short, secret-free description of a provider error for the admin panel. */
export function describeFailure(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { issue?: string | null; status?: number; debugId?: string | null; code?: string; type?: string; message?: string };
    if (e.issue !== undefined) return [e.issue, e.status && `HTTP ${e.status}`, e.debugId && `debug_id ${e.debugId}`].filter(Boolean).join(' · ');
    // Stripe: the type, code, the field it refers to and Stripe's own explanation (keys masked).
    if (e.type || e.code) {
      const se = error as { param?: string; requestId?: string };
      const text = e.message?.replace(/\b(sk|rk|pk|whsec)_[A-Za-z0-9_*]+/g, '[ключ]').slice(0, 160);
      return [e.type, e.code, se.param && t('поле {0}', se.param), text, se.requestId].filter(Boolean).join(' · ').slice(0, 300);
    }
    if (e.message) return e.message.slice(0, 200);
  }
  return String(error).slice(0, 200);
}

const DAY = 86_400_000;

/** Delivers a paid order: coins through the coin ledger (idempotent key), VIP days on top of the current ones. */
export async function deliverPayment(tx: Tx, p: Payment, now: Date) {
  const label = paidProduct(p.productId)?.label ?? p.productId;
  if (p.coins && p.giftUserId) {
    // 1.3.2.2: a pack bought for another player — the coins are theirs.
    const [from] = await tx.select({ name: users.username }).from(users).where(eq(users.id, p.userId));
    const [to] = await tx.select({ name: users.username }).from(users).where(eq(users.id, p.giftUserId));
    await postCoins(tx, p.giftUserId, { amount: p.coins, reason: 'gift_received', description: t('Подарък от {0}: {1}', from?.name ?? '', label), idempotencyKey: `payment:${p.id}` });
    await notify(tx, p.giftUserId, 'achievement', () => t('🎁 {0} ти подари {1} TC!', from?.name ?? '', p.coins), () => t('ТрансКоин вече са в профила ти.'), '/game/shop');
    await notify(tx, p.userId, 'success', () => t('Подаръкът е изпратен'), () => t('{0} получи {1} TC от теб. Благодарим!', to?.name ?? '', p.coins), '/game/shop');
    // No purchase bonuses on a gift (first purchase, weekend, patron): the pack is exactly what it says.
    return;
  }
  if (p.coins) await postCoins(tx, p.userId, { amount: p.coins, reason: 'purchase', description: t('Покупка: {0}', label), idempotencyKey: `payment:${p.id}` });
  if (p.vipDays) {
    const [u] = await tx.select({ vipUntil: users.vipUntil }).from(users).where(eq(users.id, p.userId)).for('update');
    await tx.update(users).set({ vipUntil: new Date(Math.max(now.getTime(), u?.vipUntil?.getTime() ?? 0) + p.vipDays * DAY) }).where(eq(users.id, p.userId));
  }
  await deliverExtras(tx, p, now);
  await notify(tx, p.userId, 'success', () => t('Плащането е получено'), () => t('{0} — добавено към профила ти. Благодарим за подкрепата!', label), '/game/shop');
}

/**
 * Marks a locked, pending payment as paid and delivers it — only when the
 * provider's confirmed amount and currency are exactly what we charged.
 */
export async function settlePaid(tx: Tx, p: Payment, confirmed: { amountCents: number | null; currency: string | null }, ids: Partial<Pick<Payment, 'paymentIntentId' | 'captureId'>>, now: Date) {
  if (p.status === 'paid' || p.status === 'refunded') return p.status;
  if (confirmed.amountCents !== p.amountCents || confirmed.currency?.toLowerCase() !== p.currency) {
    console.error('[payments] amount mismatch', { payment: p.id, expected: p.amountCents, got: confirmed.amountCents, currency: confirmed.currency });
    await tx.update(payments).set({ status: 'failed', ...ids }).where(eq(payments.id, p.id));
    return 'failed' as const;
  }
  await tx.update(payments).set({ status: 'paid', paidAt: now, ...ids }).where(eq(payments.id, p.id));
  await deliverPayment(tx, p, now);
  // 1.3.2.2: the VIP level follows what the player has paid.
  await refreshVipLevel(tx, p.userId);
  return 'paid' as const;
}

/** A paid order was refunded in full: the coins and VIP days are taken back (once). */
export async function refundLocked(tx: Tx, p: Payment, now: Date) {
  if (p.status !== 'paid') return false;
  await tx.update(payments).set({ status: 'refunded', refundedAt: now }).where(eq(payments.id, p.id));
  await refreshVipLevel(tx, p.userId);
  // The balance may go below zero if the coins were already spent; nothing more can be bought until it is positive.
  await refundExtras(tx, p, now);
  if (p.coins) await postCoins(tx, p.giftUserId ?? p.userId, { amount: -p.coins, reason: 'payment_refund', description: t('Върнато плащане: {0}', paidProduct(p.productId)?.label ?? p.productId), idempotencyKey: `payment-refund:${p.id}` });
  if (p.vipDays) {
    const [u] = await tx.select({ vipUntil: users.vipUntil }).from(users).where(eq(users.id, p.userId)).for('update');
    if (u?.vipUntil) await tx.update(users).set({ vipUntil: new Date(u.vipUntil.getTime() - p.vipDays * DAY) }).where(eq(users.id, p.userId));
  }
  await notify(tx, p.userId, 'warning', () => t('Плащането е възстановено'), () => t('Сумата {0} е върната; съответните ТрансКоин / VIP дни са премахнати.', euro(p.amountCents)), '/game/shop');
  return true;
}

/** Converts a provider's decimal string ("9.99") to cents without floating-point surprises. */
export function toCents(value: string | null | undefined): number | null {
  if (!value || !/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const [whole, frac = ''] = value.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
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
