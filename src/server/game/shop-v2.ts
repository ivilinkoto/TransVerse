/**
 * 1.2.3 „Отворен път“: the new shop on the server (feature `shop_v2`) — the
 * weekly VIP case, the monthly card, patron levels, a Truck Pass level for
 * ТрансКоин at the end of a season, and the extras of a real-money purchase.
 * ТрансКоин move only through `postCoins`, items only through `grantItem`,
 * each with a unique key, so nothing is ever given twice.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, like, ne, sql } from 'drizzle-orm';
import { levelStart, passLevelOf, passLevels, passVersion } from '@/lib/game/season-pass';
import { bonusWeekend, FIRST_PURCHASE_MULTIPLIER, isoWeek, MONTH_CARD, PASS_LEVEL_SALE, patronBonus, patronLevel, REFERRAL_PURCHASE_SHARE, sofiaDay, STARTER_PACK, VIP_V2, WEEKEND_BONUS } from '@/lib/game/shop-v2';
import { isVip } from '@/lib/game/vip';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { coinEntries, jobState, payments, seasonPasses, users } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { postCoins } from './coins';
import { fail } from './errors';
import { grantItem } from './inventory';
import { logActivity, notify } from './notify';
import { activeSeason } from './seasons';
import { t } from '@/i18n/t';

const DAY = 86_400_000;

async function requireV2(db: DbOrTx, userId: string, now: Date) {
  if (!(await featureFor(db, userId, 'shop_v2', now))) fail('not_released', t('Това идва със следващото обновление.'), 403);
}

// ---------- the weekly VIP case ----------
const vipCaseKey = (userId: string, now: Date) => `vip-case:${userId}:${isoWeek(now)}`;

export async function vipCaseReady(db: DbOrTx, userId: string, vipUntil: Date | null, now: Date) {
  if (!isVip(vipUntil, now)) return false;
  const [row] = await db.select({ key: jobState.key }).from(jobState).where(eq(jobState.key, vipCaseKey(userId, now)));
  return !row;
}

/** VIP: a silver case once a week (ISO week, Sofia time). */
export async function claimVipCase(db: Database, userId: string, now = new Date()) {
  await requireV2(db, userId, now);
  return db.transaction(async (tx) => {
    const [u] = await tx.select({ vipUntil: users.vipUntil }).from(users).where(eq(users.id, userId)).for('update');
    if (!isVip(u?.vipUntil, now)) fail('vip_only', t('Седмичният кейс е за VIP играчите.'), 403);
    const [first] = await tx.insert(jobState).values({ key: vipCaseKey(userId, now), value: { at: now.toISOString() } }).onConflictDoNothing().returning();
    if (!first) fail('already_claimed', t('Тази седмица вече взе VIP кейса. Следващият е в понеделник.'), 409);
    await grantItem(tx, userId, VIP_V2.weeklyCase, 1, 'vip_case', vipCaseKey(userId, now));
    return { item: VIP_V2.weeklyCase };
  });
}

// ---------- the monthly card ----------
const cardKey = (userId: string) => `month-card:${userId}`;
const cardDayKey = (userId: string, now: Date) => `month-card:${userId}:${sofiaDay(now)}`;

export async function monthCardOf(db: DbOrTx, userId: string, now: Date) {
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, cardKey(userId)));
  const until = row ? new Date((row.value as { until: string }).until) : null;
  const active = !!until && until > now;
  const [today] = active ? await db.select({ key: coinEntries.idempotencyKey }).from(coinEntries).where(eq(coinEntries.idempotencyKey, cardDayKey(userId, now))) : [];
  return { active, until, ready: active && !today, coinsPerDay: MONTH_CARD.coinsPerDay };
}

async function extendMonthCard(tx: Tx, userId: string, days: number, now: Date) {
  const [row] = await tx.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, cardKey(userId))).for('update');
  const from = row ? new Date((row.value as { until: string }).until) : null;
  const until = new Date(Math.max(now.getTime(), from?.getTime() ?? 0) + days * DAY);
  await tx.insert(jobState).values({ key: cardKey(userId), value: { until: until.toISOString() } }).onConflictDoUpdate({ target: jobState.key, set: { value: { until: until.toISOString() } } });
  return until;
}

/** The monthly card: the ТрансКоин of today, once a day while the card is active. */
export async function claimMonthCard(db: Database, userId: string, now = new Date()) {
  await requireV2(db, userId, now);
  return db.transaction(async (tx) => {
    const card = await monthCardOf(tx, userId, now);
    if (!card.active) fail('no_card', t('Нямаш активна месечна карта.'), 403);
    const got = await postCoins(tx, userId, { amount: MONTH_CARD.coinsPerDay, reason: 'purchase', description: t('Месечна карта — {0} TC за днес', MONTH_CARD.coinsPerDay), idempotencyKey: cardDayKey(userId, now) });
    if (!got) fail('already_claimed', t('Днешните ТрансКоин от картата вече са взети. Ела утре!'), 409);
    return { coins: MONTH_CARD.coinsPerDay };
  });
}

// ---------- patron levels ----------
/** Everything the player paid (refunds excluded), in euro cents, and the patron level. */
export async function patronOf(db: DbOrTx, userId: string, excludePaymentId?: string) {
  const [{ cents = 0 } = {}] = await db
    .select({ cents: sql<number>`coalesce(sum(${payments.amountCents}), 0)::int` })
    .from(payments)
    .where(and(eq(payments.userId, userId), eq(payments.status, 'paid'), ...(excludePaymentId ? [ne(payments.id, excludePaymentId)] : [])));
  const level = patronLevel(cents);
  return { paidCents: cents, level, bonus: patronBonus(level) };
}

/** May the player still buy the starter pack (once per account, from level STARTER_PACK.minLevel)? */
export async function starterPackOpen(db: DbOrTx, userId: string, level: number) {
  if (level < STARTER_PACK.minLevel) return false;
  const [bought] = await db.select({ id: payments.id }).from(payments).where(and(eq(payments.userId, userId), eq(payments.productId, 'starter_pack'), eq(payments.status, 'paid')));
  return !bought;
}

/** Has the player never bought ТрансКоин (the first pack is doubled)? */
export async function firstPurchaseOpen(db: DbOrTx, userId: string) {
  const [paid] = await db.select({ id: payments.id }).from(payments).where(and(eq(payments.userId, userId), sql`${payments.status} in ('paid', 'refunded')`, like(payments.productId, 'tc_%')));
  return !paid;
}

// ---------- real-money extras ----------
/**
 * Called once when a paid order is delivered: the starter case, the monthly
 * card, and the bonus ТрансКоин of a pack (first purchase ×2, the bonus
 * weekend, the patron level) plus the inviter's share of a first purchase.
 */
export async function deliverExtras(tx: Tx, p: { id: string; userId: string; productId: string; coins: number }, now: Date) {
  if (!(await featureFor(tx, p.userId, 'shop_v2', now))) return;
  const key = (k: string) => `payment-extra:${p.id}:${k}`;
  if (p.productId === 'starter_pack') await grantItem(tx, p.userId, STARTER_PACK.case, 1, 'starter_pack', key('case'));
  if (p.productId === 'month_card') {
    const until = await extendMonthCard(tx, p.userId, MONTH_CARD.days, now);
    await notify(tx, p.userId, 'success', () => t('Месечната карта е активна'), () => t('{0} TC всеки ден до {1} — вземи ги от магазина или от „Награди“.', MONTH_CARD.coinsPerDay, until.toLocaleDateString('bg-BG')), '/game/shop');
  }
  if (!p.productId.startsWith('tc_') || !p.coins) return;
  const [earlier] = await tx.select({ id: payments.id }).from(payments).where(and(eq(payments.userId, p.userId), ne(payments.id, p.id), sql`${payments.status} in ('paid', 'refunded')`, like(payments.productId, 'tc_%')));
  const first = !earlier;
  const patron = await patronOf(tx, p.userId, p.id);
  const parts: string[] = [];
  let bonus = 0;
  if (first) { bonus += p.coins * (FIRST_PURCHASE_MULTIPLIER - 1); parts.push(t('първа покупка ×2')); }
  if (bonusWeekend(now)) { bonus += Math.round(p.coins * WEEKEND_BONUS); parts.push(t('уикенд +{0}%', WEEKEND_BONUS * 100)); }
  if (patron.bonus > 0) { bonus += Math.round(p.coins * patron.bonus); parts.push(t('покровител ниво {0} +{1}%', patron.level, Math.round(patron.bonus * 100))); }
  if (bonus > 0) await postCoins(tx, p.userId, { amount: bonus, reason: 'purchase', description: t('Бонус към покупката: {0}', parts.join(', ')), idempotencyKey: key('bonus') });
  if (first) {
    const [me] = await tx.select({ by: users.referredById, name: users.username }).from(users).where(eq(users.id, p.userId));
    const share = Math.round(p.coins * REFERRAL_PURCHASE_SHARE);
    if (me?.by && share > 0) {
      await postCoins(tx, me.by, { amount: share, reason: 'referral_reward', description: t('{0} от първата покупка на {1}', `${Math.round(REFERRAL_PURCHASE_SHARE * 100)}%`, me.name), idempotencyKey: key('ref') });
      await notify(tx, me.by, 'success', () => t('+{0} TC от поканен приятел', share), () => t('{0} направи първата си покупка.', me.name), '/game/invite');
    }
  }
}

/** A refunded order: the bonus ТрансКоин (also the inviter's share) and the monthly card are taken back. */
export async function refundExtras(tx: Tx, p: { id: string; userId: string; productId: string }, now: Date) {
  const given = await tx.select().from(coinEntries).where(and(like(coinEntries.idempotencyKey, `payment-extra:${p.id}:%`), sql`${coinEntries.amount} > 0`));
  for (const e of given) await postCoins(tx, e.userId, { amount: -e.amount, reason: 'payment_refund', description: t('Върнато плащане: бонус'), idempotencyKey: `refund:${e.idempotencyKey}` });
  if (p.productId === 'month_card') {
    const [row] = await tx.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, cardKey(p.userId))).for('update');
    if (row) {
      const until = new Date(new Date((row.value as { until: string }).until).getTime() - MONTH_CARD.days * DAY);
      await tx.update(jobState).set({ value: { until: until.toISOString() } }).where(eq(jobState.key, cardKey(p.userId)));
    }
  }
  void now;
}

// ---------- Truck Pass level ----------
export function passLevelSaleOpen(seasonEndsAt: Date, now: Date) {
  return seasonEndsAt.getTime() - now.getTime() <= PASS_LEVEL_SALE.lastDays * DAY && seasonEndsAt > now;
}

/** In the last week of a season: one pass level for ТрансКоин (pass points only — never season points or ranks). */
export async function buyPassLevel(db: Database, userId: string, now = new Date()) {
  await requireV2(db, userId, now);
  return db.transaction(async (tx) => {
    const season = await activeSeason(tx, now);
    if (!passLevelSaleOpen(season.endsAt, now)) fail('not_now', t('Нива се купуват само в последните {0} дни на сезона.', PASS_LEVEL_SALE.lastDays), 409);
    const [row] = await tx.select({ points: seasonPasses.points }).from(seasonPasses).where(and(eq(seasonPasses.seasonId, season.id), eq(seasonPasses.userId, userId))).for('update');
    // 1.2.5: with the pass of 50 levels, one level is exactly the points to the next one.
    const v = passVersion(season.rules);
    const have = row?.points ?? 0;
    const level = passLevelOf(have, v);
    if (level >= passLevels(v)) fail('max_level', t('Пропускът вече е на последното ниво.'), 409);
    const add = v === 2 ? levelStart(level + 1, 2) - have : PASS_LEVEL_SALE.points;
    await postCoins(tx, userId, { amount: -PASS_LEVEL_SALE.coins, reason: 'season_pass', description: t('Ниво от пропуска: {0}', season.name), idempotencyKey: `pass-level:${userId}:${randomUUID()}` }, { requireFunds: true });
    await tx.insert(seasonPasses).values({ seasonId: season.id, userId, points: add }).onConflictDoUpdate({ target: [seasonPasses.seasonId, seasonPasses.userId], set: { points: sql`${seasonPasses.points} + ${add}`, updatedAt: now } });
    await logActivity(tx, userId, 'pass_level_bought', { seasonId: season.id });
  });
}
