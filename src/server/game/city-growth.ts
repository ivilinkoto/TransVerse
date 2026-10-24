import { and, desc, eq, sql } from 'drizzle-orm';
import { cityLevel, cityPayFactor, HARVEST } from '@/lib/game/city-growth';
import { featureLive } from '@/lib/game/features';
import { BADGES } from '@/lib/game/halloween';
import { periodWindow } from '@/lib/game/missions';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, cityGrowth, harvestProgress, userBadges } from '@/server/db/schema';
import { appUrl } from '@/server/discord/config';
import { announce } from '@/server/discord/outbox';
import { postCoins } from './coins';
import { notify } from './notify';
import { t, intlLocale } from '@/i18n/t';

const weekKey = (at: Date) => periodWindow('weekly', at).key;

/** A delivery adds its tonnes to the destination city (for everyone). */
export async function growCity(tx: Tx, cityId: number, tons: number, at: Date) {
  if (!featureLive('city_growth', at) || tons <= 0) return;
  const week = weekKey(at);
  await tx
    .insert(cityGrowth)
    .values({ cityId, tons, weekKey: week, weekTons: tons, updatedAt: at })
    .onConflictDoUpdate({
      target: cityGrowth.cityId,
      set: {
        tons: sql`${cityGrowth.tons} + ${tons}`,
        weekTons: sql`case when ${cityGrowth.weekKey} = ${week} then ${cityGrowth.weekTons} + ${tons} else ${tons} end`,
        weekKey: week,
        updatedAt: at,
      },
    });
}

/** The pay factor for loads leaving a city (its level). */
export async function cityPay(db: DbOrTx, cityId: number, now: Date) {
  if (!featureLive('city_growth', now)) return 1;
  const [g] = await db.select({ tons: cityGrowth.tons }).from(cityGrowth).where(eq(cityGrowth.cityId, cityId));
  return g ? cityPayFactor(cityLevel(g.tons).level) : 1;
}

export async function cityGrowthOf(db: DbOrTx, cityId: number) {
  const [g] = await db.select().from(cityGrowth).where(eq(cityGrowth.cityId, cityId));
  return { ...cityLevel(g?.tons ?? 0), tons: g?.tons ?? 0 };
}

/** This week's race and the biggest cities of all time. */
export async function cityRankings(db: DbOrTx, now: Date) {
  const week = weekKey(now);
  const row = { id: cities.id, name: cities.nameBg, country: cities.countryCode, tons: cityGrowth.tons, weekTons: cityGrowth.weekTons };
  const [thisWeek, allTime] = await Promise.all([
    db.select(row).from(cityGrowth).innerJoin(cities, eq(cities.id, cityGrowth.cityId)).where(and(eq(cityGrowth.weekKey, week), sql`${cityGrowth.weekTons} > 0`)).orderBy(desc(cityGrowth.weekTons)).limit(15),
    db.select(row).from(cityGrowth).innerJoin(cities, eq(cities.id, cityGrowth.cityId)).orderBy(desc(cityGrowth.tons)).limit(15),
  ]);
  return { week, thisWeek, allTime: allTime.map((c) => ({ ...cityLevel(c.tons), ...c })) };
}

/** Monday: last week's winning city in Discord. */
export async function announceCityOfWeek(db: Database, now = new Date()) {
  if (!featureLive('city_growth', now) || !featureLive('discord_bot', now)) return false;
  const last = weekKey(new Date(now.getTime() - 3 * 86_400_000));
  const [top] = await db.select({ name: cities.nameBg, weekTons: cityGrowth.weekTons, tons: cityGrowth.tons }).from(cityGrowth).innerJoin(cities, eq(cities.id, cityGrowth.cityId)).where(eq(cityGrowth.weekKey, last)).orderBy(desc(cityGrowth.weekTons)).limit(1);
  if (!top) return false;
  await announce(db, `city-week:${last}`, 'rankings', {
    embeds: [{ title: t('🏙️ Град на седмицата: {0}', top.name), url: `${appUrl()}/game/cities`, color: 0x22d3ee, description: t('{0} т доставени за седмицата · „{1}“.', Math.round(top.weekTons).toLocaleString(intlLocale()), cityLevel(top.tons).name), footer: { text: t('TransVerse · игрови данни') } }],
  }, now);
  return true;
}

/** Гроздобер: a harvest load on time counts; ten in a season — a badge and ТрансКоин (once). */
export async function harvestDelivered(tx: Tx, userId: string, holiday: string | null, late: boolean, at: Date) {
  if (holiday !== 'harvest' || late || !featureLive('harvest', at)) return;
  const year = at.getUTCFullYear();
  const [p] = await tx.insert(harvestProgress).values({ userId, year, loads: 1 }).onConflictDoUpdate({ target: [harvestProgress.userId, harvestProgress.year], set: { loads: sql`${harvestProgress.loads} + 1` } }).returning();
  if (!p || p.rewarded || p.loads < HARVEST.loadsForBadge) return;
  const [won] = await tx.update(harvestProgress).set({ rewarded: true }).where(and(eq(harvestProgress.userId, userId), eq(harvestProgress.year, year), eq(harvestProgress.rewarded, false))).returning();
  if (!won) return;
  await postCoins(tx, userId, { amount: HARVEST.coins, reason: 'harvest', description: t('Гроздобер {0}: {1} есенни товара', year, HARVEST.loadsForBadge), idempotencyKey: `harvest:${year}:${userId}` });
  await tx.insert(userBadges).values({ userId, badge: HARVEST.badge, awardedAt: at }).onConflictDoNothing();
  await notify(tx, userId, 'achievement', () => t('Значка: {0} 🍇', BADGES[HARVEST.badge]?.label ?? t('Гроздобер')), () => t('{0} есенни товара навреме: +{1} TC.', HARVEST.loadsForBadge, HARVEST.coins), '/game/progress');
}

export async function harvestOf(db: DbOrTx, userId: string, now: Date) {
  const [p] = await db.select().from(harvestProgress).where(and(eq(harvestProgress.userId, userId), eq(harvestProgress.year, now.getUTCFullYear())));
  return { loads: p?.loads ?? 0, rewarded: !!p?.rewarded };
}
