import { and, asc, count, eq, isNull, lt, ne, sql } from 'drizzle-orm';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { co2Credits, co2Listings, co2Weeks, companies, vehicles } from '@/server/db/schema';
import { CO2, co2KgOf, co2Week, quotaKg } from '@/lib/game/co2';
import { featureLive } from '@/lib/game/features';
import { weekKey } from '@/lib/game/leagues';
import { t } from '@/i18n/t';
import { companyForUser } from './company';
import { fail } from './errors';
import { post } from './finance';
import { notify } from './notify';

/** 1.1.4.2 „CO₂ квоти“. */
export async function recordCo2(tx: Tx, companyId: string, litres: number, now: Date) {
  const kg = co2KgOf(litres);
  if (kg <= 0) return 0;
  await tx.insert(co2Weeks).values({ companyId, week: weekKey(now), kg }).onConflictDoUpdate({ target: [co2Weeks.companyId, co2Weeks.week], set: { kg: sql`${co2Weeks.kg} + ${kg}` } });
  return kg;
}

const trucksOf = async (db: DbOrTx, companyId: string) =>
  (await db.select({ n: count() }).from(vehicles).where(and(eq(vehicles.companyId, companyId), isNull(vehicles.soldAt), ne(vehicles.ownership, 'rented'))))[0]?.n ?? 0;

export async function co2Of(db: DbOrTx, companyId: string, now = new Date()) {
  const week = weekKey(now);
  const [w] = await db.select().from(co2Weeks).where(and(eq(co2Weeks.companyId, companyId), eq(co2Weeks.week, week)));
  const [c] = await db.select().from(co2Credits).where(eq(co2Credits.companyId, companyId));
  const quota = quotaKg(await trucksOf(db, companyId));
  const listings = await db.select().from(co2Listings).orderBy(asc(co2Listings.priceCents)).limit(20);
  return { week, kg: w?.kg ?? 0, quotaKg: quota, credits: c?.tonnes ?? 0, listings };
}

const addCredits = (tx: Tx, companyId: string, tonnes: number) =>
  tx.insert(co2Credits).values({ companyId, tonnes }).onConflictDoUpdate({ target: co2Credits.companyId, set: { tonnes: sql`${co2Credits.tonnes} + ${tonnes}` } });

async function takeCredits(tx: Tx, companyId: string, tonnes: number) {
  const [c] = await tx.select().from(co2Credits).where(eq(co2Credits.companyId, companyId)).for('update');
  if (!c || c.tonnes + 1e-9 < tonnes) fail('no_credits', t('Нямаш толкова CO₂ кредити.'));
  await tx.update(co2Credits).set({ tonnes: c!.tonnes - tonnes }).where(eq(co2Credits.companyId, companyId));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export async function sellCo2ToMarket(db: Database, userId: string, tonnes: number) {
  const tn = round1(tonnes);
  if (tn <= 0) fail('bad_amount', t('Невалидно количество.'));
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    await takeCredits(tx, company.id, tn);
    await post(tx, company.id, [{ category: 'co2', amountCents: Math.round(tn * CO2.marketBuyCents), description: t('Продадени CO₂ кредити: {0} т', tn), idempotencyKey: `co2-market:${company.id}:${Date.now()}` }]);
  });
}

export async function listCo2(db: Database, userId: string, tonnes: number, priceCents: number) {
  const tn = round1(tonnes);
  if (tn <= 0) fail('bad_amount', t('Невалидно количество.'));
  if (priceCents < CO2.minPriceCents || priceCents > CO2.maxPriceCents) fail('bad_price', t('Цената е между {0} и {1} лв. за тон.', CO2.minPriceCents / 100, CO2.maxPriceCents / 100));
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    await takeCredits(tx, company.id, tn);
    const [row] = await tx.insert(co2Listings).values({ companyId: company.id, tonnes: tn, priceCents: Math.round(priceCents) }).returning();
    return row!;
  });
}

export async function cancelCo2Listing(db: Database, userId: string, id: string) {
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const [row] = await tx.delete(co2Listings).where(and(eq(co2Listings.id, id), eq(co2Listings.companyId, company.id))).returning();
    if (row) await addCredits(tx, company.id, row.tonnes);
  });
}

export async function buyCo2(db: Database, userId: string, id: string) {
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const [row] = await tx.delete(co2Listings).where(eq(co2Listings.id, id)).returning();
    if (!row) fail('listing_gone', t('Офертата вече я няма.'), 409);
    if (row!.companyId === company.id) fail('own_listing', t('Това е твоя оферта.'));
    const cents = Math.round(row!.tonnes * row!.priceCents);
    // A fixed order of the two accounts (by id), like the other trades between players.
    const buyer = { id: company.id, amount: -cents, text: t('Купени CO₂ кредити: {0} т', row!.tonnes) };
    const seller = { id: row!.companyId, amount: cents, text: t('Продадени CO₂ кредити: {0} т', row!.tonnes) };
    for (const side of [buyer, seller].sort((a, b) => a.id.localeCompare(b.id))) {
      await post(tx, side.id, [{ category: 'co2', amountCents: side.amount, description: side.text, idempotencyKey: `co2-trade:${row!.id}:${side.id}` }], { requireFunds: side.amount < 0 });
    }
    await addCredits(tx, company.id, row!.tonnes);
    return { tonnes: row!.tonnes, cents };
  });
}

/** Worker (Monday): last week's emissions against the quota — credits for the unused, the rest paid. */
export async function settleCo2Weeks(db: Database, now = new Date()) {
  if (!featureLive('co2', now)) return 0;
  const week = weekKey(now);
  const due = await db.select().from(co2Weeks).where(and(lt(co2Weeks.week, week), isNull(co2Weeks.settledAt))).limit(500);
  for (const w of due) {
    await db.transaction(async (tx) => {
      const quota = quotaKg(await trucksOf(tx, w.companyId));
      const r = co2Week(w.kg, quota);
      const [owner] = await tx.select({ ownerId: companies.ownerId }).from(companies).where(eq(companies.id, w.companyId));
      if (r.creditsT > 0) await addCredits(tx, w.companyId, r.creditsT);
      let charged = 0;
      if (r.overT > 0) {
        // Credits held cover the overrun first.
        const [c] = await tx.select().from(co2Credits).where(eq(co2Credits.companyId, w.companyId)).for('update');
        const fromCredits = Math.min(c?.tonnes ?? 0, r.overT);
        if (fromCredits > 0) await tx.update(co2Credits).set({ tonnes: c!.tonnes - fromCredits }).where(eq(co2Credits.companyId, w.companyId));
        const rest = round1(r.overT - fromCredits);
        charged = Math.round(rest * CO2.marketSellCents);
        if (charged) await post(tx, w.companyId, [{ category: 'co2', amountCents: -charged, description: t('CO₂ над квотата: {0} т ({1})', rest, w.week.slice(1)), idempotencyKey: `co2-week:${w.companyId}:${w.week}` }]);
      }
      await tx.update(co2Weeks).set({ quotaKg: quota, settledAt: now }).where(and(eq(co2Weeks.companyId, w.companyId), eq(co2Weeks.week, w.week)));
      if (owner && (r.creditsT > 0 || charged > 0))
        await notify(tx, owner.ownerId, r.creditsT > 0 ? 'success' : 'info', () => t('🌱 CO₂ за седмицата'), () => (r.creditsT > 0 ? t('Под квотата: +{0} т кредити за продажба.', r.creditsT) : t('Над квотата: платени {0} лв.', Math.round(charged / 100))), '/game/growth');
    });
  }
  return due.length;
}
