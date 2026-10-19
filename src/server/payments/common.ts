/**
 * Real-money purchases — the parts every provider shares: configuration,
 * pending payments, delivery and refunds. Providers (PayPal, Stripe) only
 * confirm that money arrived; delivery always goes through here, exactly once.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { euro, paidProduct } from '@/lib/game/payments';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { payments, users } from '@/server/db/schema';
import { postCoins } from '@/server/game/coins';
import { fail } from '@/server/game/errors';
import { notify } from '@/server/game/notify';
import { mailConfig } from '@/server/mail';

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
  if (!base) fail('payments_disabled', 'Липсва адресът на сайта (APP_URL).', 503);
  return base!.replace(/\/$/, '');
}

/** Validates the order and records a pending payment with the server's own price. */
export async function startPayment(db: Database, userId: string, input: z.output<typeof checkoutSchema>, now: Date) {
  const product = paidProduct(input.productId);
  if (!product) fail('unknown_product', 'Непознат продукт.');
  const [user] = await db.select({ email: users.email, bannedAt: users.bannedAt, verified: users.emailVerifiedAt }).from(users).where(eq(users.id, userId));
  if (!user || user.bannedAt) fail('forbidden', 'Профилът не може да прави покупки.', 403);
  // With e-mail switched on, purchases need a confirmed address (receipts, account recovery).
  if (mailConfig().enabled && !user!.verified) fail('email_unverified', 'Първо потвърди имейла си — линкът е в пощата ти (или го изпрати отново от „Профил и настройки“).', 403);
  // At most a few unfinished checkouts at a time (stops spamming the provider).
  const [{ open = 0 } = {}] = await db
    .select({ open: sql<number>`count(*)::int` })
    .from(payments)
    .where(and(eq(payments.userId, userId), eq(payments.status, 'pending'), sql`${payments.createdAt} > ${new Date(now.getTime() - 3_600_000)}`));
  if (open >= 5) fail('too_many_checkouts', 'Имате няколко незавършени плащания. Опитайте отново след малко.', 429);
  const [payment] = await db
    .insert(payments)
    .values({ userId, provider: input.provider, productId: product!.id, coins: product!.coins, vipDays: product!.vipDays, amountCents: product!.priceCents, currency: 'eur', consentAt: now })
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
      return [e.type, e.code, se.param && `поле ${se.param}`, text, se.requestId].filter(Boolean).join(' · ').slice(0, 300);
    }
    if (e.message) return e.message.slice(0, 200);
  }
  return String(error).slice(0, 200);
}

const DAY = 86_400_000;

/** Delivers a paid order: coins through the coin ledger (idempotent key), VIP days on top of the current ones. */
export async function deliverPayment(tx: Tx, p: Payment, now: Date) {
  const label = paidProduct(p.productId)?.label ?? p.productId;
  if (p.coins) await postCoins(tx, p.userId, { amount: p.coins, reason: 'purchase', description: `Покупка: ${label}`, idempotencyKey: `payment:${p.id}` });
  if (p.vipDays) {
    const [u] = await tx.select({ vipUntil: users.vipUntil }).from(users).where(eq(users.id, p.userId)).for('update');
    await tx.update(users).set({ vipUntil: new Date(Math.max(now.getTime(), u?.vipUntil?.getTime() ?? 0) + p.vipDays * DAY) }).where(eq(users.id, p.userId));
  }
  await notify(tx, p.userId, 'success', 'Плащането е получено', `${label} — добавено към профила ти. Благодарим за подкрепата!`, '/game/shop');
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
  return 'paid' as const;
}

/** A paid order was refunded in full: the coins and VIP days are taken back (once). */
export async function refundLocked(tx: Tx, p: Payment, now: Date) {
  if (p.status !== 'paid') return false;
  await tx.update(payments).set({ status: 'refunded', refundedAt: now }).where(eq(payments.id, p.id));
  // The balance may go below zero if the coins were already spent; nothing more can be bought until it is positive.
  if (p.coins) await postCoins(tx, p.userId, { amount: -p.coins, reason: 'payment_refund', description: `Върнато плащане: ${paidProduct(p.productId)?.label ?? p.productId}`, idempotencyKey: `payment-refund:${p.id}` });
  if (p.vipDays) {
    const [u] = await tx.select({ vipUntil: users.vipUntil }).from(users).where(eq(users.id, p.userId)).for('update');
    if (u?.vipUntil) await tx.update(users).set({ vipUntil: new Date(u.vipUntil.getTime() - p.vipDays * DAY) }).where(eq(users.id, p.userId));
  }
  await notify(tx, p.userId, 'warning', 'Плащането е възстановено', `Сумата ${euro(p.amountCents)} е върната; съответните ТрансКоин / VIP дни са премахнати.`, '/game/shop');
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
