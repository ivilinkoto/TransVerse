import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { dividendPool, nextSharePrice, SHARES } from '@/lib/game/shares';
import { money } from '@/lib/format';
import { periodWindow } from '@/lib/game/missions';
import type { Database, DbOrTx } from '@/server/db/client';
import { companyMembers, organizations, shareHoldings, sharePrices, treasuryEntries } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { featureLive } from '@/lib/game/features';
import { companyForUser } from './company';
import { fail } from './errors';
import { post, postTreasury } from './finance';
import { notify } from './notify';
import { t, intlLocale } from '@/i18n/t';

const DAY = 86_400_000;
const sofiaDay = (at: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia' }).format(at);

/** The members' contributions to the treasury since `since` (the company's real results). */
async function contributions(db: DbOrTx, orgId: string, since: Date) {
  const [r] = await db
    .select({ cents: sql<number>`coalesce(sum(${treasuryEntries.amountCents}), 0)::float` })
    .from(treasuryEntries)
    .where(and(eq(treasuryEntries.organizationId, orgId), eq(treasuryEntries.category, 'member_contribution'), gte(treasuryEntries.createdAt, since)));
  return Math.round(r?.cents ?? 0);
}

const outsideShares = async (db: DbOrTx, orgId: string) => {
  const [r] = await db.select({ n: sql<number>`coalesce(sum(${shareHoldings.shares}), 0)::int` }).from(shareHoldings).where(eq(shareHoldings.organizationId, orgId));
  return r?.n ?? 0;
};

/** The owner puts the company on the exchange. */
export async function listCompany(db: Database, userId: string, now = new Date()) {
  if (!(await featureFor(db, userId, 'share_market', now))) fail('not_released', t('Борсата идва с обновление 1.8.'));
  const [org] = await db.select().from(organizations).where(eq(organizations.ownerId, userId));
  if (!org) fail('not_owner', t('Само собственикът на компания може да я листне.'), 403);
  if (org!.listedAt) fail('already_listed', t('Компанията вече е на борсата.'));
  if (now.getTime() - org!.createdAt.getTime() < SHARES.minAgeDays * DAY) fail('too_young', t('Компанията трябва да е поне на {0} дни.', SHARES.minAgeDays));
  const [{ n = 0 } = {}] = await db.select({ n: sql<number>`count(*)::int` }).from(companyMembers).where(eq(companyMembers.companyId, org!.id));
  if (n < SHARES.minMembers) fail('too_small', t('Нужни са поне {0} членове.', SHARES.minMembers));
  const price = nextSharePrice(0, org!.treasuryCents, await contributions(db, org!.id, new Date(now.getTime() - SHARES.windowDays * DAY)));
  await db.update(organizations).set({ listedAt: now, sharePriceCents: price }).where(eq(organizations.id, org!.id));
  await db.insert(sharePrices).values({ organizationId: org!.id, day: sofiaDay(now), priceCents: price }).onConflictDoNothing();
  return { priceCents: price };
}

/** A player outside the company buys shares: the price goes into its treasury. */
export async function buyShares(db: Database, userId: string, orgId: string, count: number, now = new Date()) {
  if (!(await featureFor(db, userId, 'share_market', now))) fail('not_released', t('Борсата идва с обновление 1.8.'));
  if (!Number.isInteger(count) || count < 1 || count > SHARES.perPlayerMax) fail('bad_count', t('От 1 до {0} акции.', SHARES.perPlayerMax));
  const account = await companyForUser(db, userId);
  return db.transaction(async (tx) => {
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, orgId));
    if (!org?.listedAt) fail('not_listed', t('Компанията не е на борсата.'));
    const [member] = await tx.select({ id: companyMembers.userId }).from(companyMembers).where(and(eq(companyMembers.companyId, orgId), eq(companyMembers.userId, userId)));
    if (member || org!.ownerId === userId) fail('own_company', t('Не можеш да купуваш акции на своята компания.'));
    // Count the shares under a lock on the company's holdings.
    const held = await tx.select().from(shareHoldings).where(eq(shareHoldings.organizationId, orgId)).for('update');
    const outside = held.reduce((s, h) => s + h.shares, 0);
    const mine = held.find((h) => h.userId === userId);
    if ((mine?.shares ?? 0) + count > SHARES.perPlayerMax) fail('too_many', t('Най-много {0} акции на играч (имаш {1}).', SHARES.perPlayerMax, mine?.shares ?? 0));
    if (outside + count > SHARES.outsideMax) fail('sold_out', t('Свободни са {0} акции.', SHARES.outsideMax - outside));
    const cost = org!.sharePriceCents * count;
    const fee = Math.round(cost * SHARES.feeShare);
    const key = `shares:buy:${orgId}:${userId}:${now.getTime()}`;
    // Personal account first, then the treasury.
    await post(tx, account.id, [{ category: 'share_trade', amountCents: -(cost + fee), description: t('{0} акции на {1} по {2} (+1 % такса)', count, org!.name, money(org!.sharePriceCents)), idempotencyKey: key }], { requireFunds: true });
    await postTreasury(tx, orgId, [{ category: 'share_issue', amountCents: cost, description: t('Продадени {0} акции', count), idempotencyKey: `${key}:in`, actorUserId: userId }]);
    const lockedUntil = new Date(now.getTime() + SHARES.lockDays * DAY);
    if (mine) await tx.update(shareHoldings).set({ shares: mine.shares + count, costCents: mine.costCents + cost + fee, lockedUntil, updatedAt: now }).where(and(eq(shareHoldings.organizationId, orgId), eq(shareHoldings.userId, userId)));
    else await tx.insert(shareHoldings).values({ organizationId: orgId, userId, shares: count, costCents: cost + fee, lockedUntil, updatedAt: now });
    return { shares: (mine?.shares ?? 0) + count, paidCents: cost + fee };
  });
}

/** A holder sells shares back to the exchange at 97 % of the price (after the hold). */
export async function sellShares(db: Database, userId: string, orgId: string, count: number, now = new Date()) {
  if (!(await featureFor(db, userId, 'share_market', now))) fail('not_released', t('Борсата идва с обновление 1.8.'));
  if (!Number.isInteger(count) || count < 1) fail('bad_count', t('Поне 1 акция.'));
  const account = await companyForUser(db, userId);
  return db.transaction(async (tx) => {
    const [h] = await tx.select().from(shareHoldings).where(and(eq(shareHoldings.organizationId, orgId), eq(shareHoldings.userId, userId))).for('update');
    if (!h || h.shares < count) fail('not_enough', t('Имаш {0} акции.', h?.shares ?? 0));
    if (h!.lockedUntil > now) fail('locked', t('Купените акции се продават след {0}.', h!.lockedUntil.toLocaleString(intlLocale(), { timeZone: 'Europe/Sofia', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })));
    const [org] = await tx.select({ name: organizations.name, price: organizations.sharePriceCents }).from(organizations).where(eq(organizations.id, orgId));
    const payout = Math.round(org!.price * count * SHARES.sellShare);
    await post(tx, account.id, [{ category: 'share_trade', amountCents: payout, description: t('Продадени {0} акции на {1}', count, org!.name), idempotencyKey: `shares:sell:${orgId}:${userId}:${now.getTime()}` }]);
    const left = h!.shares - count;
    if (left === 0) await tx.delete(shareHoldings).where(and(eq(shareHoldings.organizationId, orgId), eq(shareHoldings.userId, userId)));
    else await tx.update(shareHoldings).set({ shares: left, costCents: Math.round((h!.costCents * left) / h!.shares), updatedAt: now }).where(and(eq(shareHoldings.organizationId, orgId), eq(shareHoldings.userId, userId)));
    return { shares: left, payoutCents: payout };
  });
}

/** Daily: every listed company's price moves towards its value. */
export async function updateSharePrices(db: Database, now = new Date()) {
  const listed = await db.select().from(organizations).where(isNotNull(organizations.listedAt));
  const since = new Date(now.getTime() - SHARES.windowDays * DAY);
  for (const org of listed) {
    const price = nextSharePrice(org.sharePriceCents, org.treasuryCents, await contributions(db, org.id, since));
    await db.update(organizations).set({ sharePriceCents: price }).where(eq(organizations.id, org.id));
    await db.insert(sharePrices).values({ organizationId: org.id, day: sofiaDay(now), priceCents: price }).onConflictDoUpdate({ target: [sharePrices.organizationId, sharePrices.day], set: { priceCents: price } });
  }
  return listed.length;
}

/** Monday: each listed company pays its outside holders 20 % of last week's contributions, by their share. */
export async function payDividends(db: Database, now = new Date()) {
  if (!featureLive('share_market', now)) return 0;
  const week = periodWindow('weekly', new Date(now.getTime() - 7 * DAY)).key;
  const since = new Date(now.getTime() - 7 * DAY);
  const listed = await db.select({ id: organizations.id, name: organizations.name, treasury: organizations.treasuryCents }).from(organizations).where(isNotNull(organizations.listedAt));
  let paid = 0;
  for (const org of listed) {
    const holders = await db.select({ userId: shareHoldings.userId, shares: shareHoldings.shares }).from(shareHoldings).where(eq(shareHoldings.organizationId, org.id)).orderBy(asc(shareHoldings.userId));
    const outside = holders.reduce((s, h) => s + h.shares, 0);
    const pool = dividendPool(await contributions(db, org.id, since), outside);
    if (pool <= 0 || org.treasury < pool) continue;
    const accounts = await Promise.all(holders.map(async (h) => ({ ...h, account: await companyForUser(db, h.userId) })));
    await db.transaction(async (tx) => {
      let total = 0;
      // Personal accounts first (in a fixed order), then the treasury.
      for (const h of accounts) {
        const cents = Math.floor((pool * h.shares) / outside);
        if (cents <= 0) continue;
        await post(tx, h.account.id, [{ category: 'share_dividend', amountCents: cents, description: t('Дивидент от {0} ({1} акции)', org.name, h.shares), idempotencyKey: `dividend:${org.id}:${week}:${h.userId}` }]);
        await notify(tx, h.userId, 'info', () => t('Дивидент от {0} 📈', org.name), () => t('{0} за {1} акции.', money(cents), h.shares), '/game/shares');
        total += cents;
      }
      if (total > 0) await postTreasury(tx, org.id, [{ category: 'share_dividend', amountCents: -total, description: t('Дивиденти за седмица {0}', week.slice(1)), idempotencyKey: `dividend:${org.id}:${week}` }], { requireFunds: true });
      paid += total;
    });
  }
  return paid;
}

/** The exchange page: listed companies with the price trend, and the player's holdings. */
export async function shareMarketView(db: DbOrTx, userId: string, now = new Date()) {
  const listed = await db
    .select({ id: organizations.id, name: organizations.name, tag: organizations.tag, color: organizations.color, price: organizations.sharePriceCents, listedAt: organizations.listedAt, ownerId: organizations.ownerId })
    .from(organizations)
    .where(isNotNull(organizations.listedAt))
    .orderBy(desc(organizations.sharePriceCents));
  const ids = listed.map((l) => l.id);
  const [prices, holdings, outside, myOrg] = await Promise.all([
    ids.length ? db.select().from(sharePrices).where(and(inArray(sharePrices.organizationId, ids), gte(sharePrices.day, sofiaDay(new Date(now.getTime() - 30 * DAY))))).orderBy(asc(sharePrices.day)) : [],
    db.select().from(shareHoldings).where(eq(shareHoldings.userId, userId)),
    ids.length ? db.select({ id: shareHoldings.organizationId, n: sql<number>`sum(${shareHoldings.shares})::int` }).from(shareHoldings).where(inArray(shareHoldings.organizationId, ids)).groupBy(shareHoldings.organizationId) : [],
    db.select({ id: companyMembers.companyId }).from(companyMembers).where(eq(companyMembers.userId, userId)),
  ]);
  return listed.map((l) => {
    const history = prices.filter((p) => p.organizationId === l.id).map((p) => p.priceCents);
    const week = history.at(-8) ?? history[0] ?? l.price;
    const h = holdings.find((x) => x.organizationId === l.id);
    return {
      id: l.id,
      name: l.name,
      tag: l.tag,
      color: l.color,
      priceCents: l.price,
      changeWeek: week > 0 ? (l.price - week) / week : 0,
      history,
      free: SHARES.outsideMax - (outside.find((o) => o.id === l.id)?.n ?? 0),
      own: myOrg[0]?.id === l.id,
      holding: h ? { shares: h.shares, costCents: h.costCents, valueCents: Math.round(h.shares * l.price * SHARES.sellShare), lockedUntil: h.lockedUntil.toISOString(), locked: h.lockedUntil > now } : null,
    };
  });
}

/** For the company page: whether the owner may list it now. */
export async function listingStatus(db: DbOrTx, orgId: string, now = new Date()) {
  const [org] = await db.select({ listedAt: organizations.listedAt, createdAt: organizations.createdAt, price: organizations.sharePriceCents }).from(organizations).where(eq(organizations.id, orgId));
  if (!org) return null;
  const [{ n = 0 } = {}] = await db.select({ n: sql<number>`count(*)::int` }).from(companyMembers).where(eq(companyMembers.companyId, orgId));
  return { listed: !!org.listedAt, priceCents: org.price, outside: await outsideShares(db, orgId), oldEnough: now.getTime() - org.createdAt.getTime() >= SHARES.minAgeDays * DAY, bigEnough: n >= SHARES.minMembers };
}

