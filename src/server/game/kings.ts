import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { COUNTRY_KINGS } from '@/lib/game/europe';
import { featureLive } from '@/lib/game/features';
import { periodWindow, sofiaMidnight, sofiaParts } from '@/lib/game/missions';
import type { Database, DbOrTx } from '@/server/db/client';
import { cities, companies, contracts, countries, countryKings, deliveries, users } from '@/server/db/schema';
import { appUrl } from '@/server/discord/config';
import { announce } from '@/server/discord/outbox';
import { postCoins } from './coins';
import { notify } from './notify';
import { t, intlLocale } from '@/i18n/t';

const monthWindow = (at: Date) => {
  const { y, m } = sofiaParts(at);
  const w = periodWindow('monthly', at);
  return { key: w.key, startsAt: sofiaMidnight(y, m, 1), endsAt: w.endsAt };
};

/** Tons each player brought into each country between two times, best first per country. */
export async function countryTons(db: DbOrTx, from: Date, to: Date, countryCode?: string) {
  const tons = sql<number>`sum(${contracts.weightTons})`.mapWith(Number);
  return db
    .select({ countryCode: cities.countryCode, userId: companies.ownerId, username: users.username, tons })
    .from(deliveries)
    .innerJoin(companies, eq(companies.id, deliveries.companyId))
    .innerJoin(users, eq(users.id, companies.ownerId))
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .innerJoin(cities, eq(cities.id, contracts.destCityId))
    .where(and(eq(deliveries.status, 'completed'), gte(deliveries.completedAt, from), lt(deliveries.completedAt, to), countryCode ? eq(cities.countryCode, countryCode) : undefined))
    .groupBy(cities.countryCode, companies.ownerId, users.username)
    .orderBy(cities.countryCode, desc(tons));
}

/**
 * Once a month crowns last month's king of every country (at least the
 * minimum tons), pays a little ТрансКоин and tells Discord.
 */
export async function settleCountryKings(db: Database, now: Date) {
  if (!featureLive('country_kings', now)) return null;
  const current = monthWindow(now);
  const last = monthWindow(new Date(current.startsAt.getTime() - 3_600_000));
  const [done] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(countryKings).where(eq(countryKings.month, last.key));
  if (done!.n > 0) return null;
  const best = new Map<string, { userId: string; username: string; tons: number }>();
  for (const r of await countryTons(db, last.startsAt, last.endsAt)) if (!best.has(r.countryCode) && r.tons >= COUNTRY_KINGS.minTons) best.set(r.countryCode, r);
  if (!best.size) return { month: last.key, kings: 0 };
  const names = new Map((await db.select({ code: countries.code, nameBg: countries.nameBg }).from(countries)).map((c) => [c.code, c.nameBg]));
  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(countryKings)
      .values([...best].map(([countryCode, k]) => ({ month: last.key, countryCode, userId: k.userId, tons: Math.round(k.tons * 10) / 10 })))
      .onConflictDoNothing()
      .returning();
    for (const k of rows) {
      const country = names.get(k.countryCode) ?? k.countryCode;
      await postCoins(tx, k.userId, { amount: COUNTRY_KINGS.coins, reason: 'challenge', description: t('Крал на {0} ({1})', country, last.key.slice(1)), idempotencyKey: `country-king:${last.key}:${k.countryCode}` });
      await notify(tx, k.userId, 'achievement', () => t('Крал на {0}! 👑', country), () => t('Най-много тонове до {0} миналия месец — {1} т. Титлата е твоя този месец, плюс {2} TC.', country, k.tons.toLocaleString(intlLocale()), COUNTRY_KINGS.coins), '/game/my-map');
    }
    if (rows.length && featureLive('discord_bot', now)) {
      const lines = rows
        .map((k) => ({ ...k, country: names.get(k.countryCode) ?? k.countryCode, username: best.get(k.countryCode)!.username }))
        .sort((a, b) => a.country.localeCompare(b.country, 'bg'))
        .map((k) => t('**{0}** · {1} · {2} т', k.country, k.username, k.tons.toLocaleString(intlLocale())));
      await announce(tx, `country-kings:${last.key}`, 'rankings', {
        embeds: [{ title: t('👑 Кралете на държавите · {0}', last.key.slice(1)), url: `${appUrl()}/game/my-map`, color: 0xf6c343, description: lines.join('\n').slice(0, 4000), footer: { text: t('TransVerse · игрови данни') } }],
      }, now);
    }
    return { month: last.key, kings: rows.length };
  });
}

/** The latest kings (the titles held this month), with names. */
export async function currentKings(db: DbOrTx) {
  const [latest] = await db.select({ month: countryKings.month }).from(countryKings).orderBy(desc(countryKings.month)).limit(1);
  if (!latest) return [];
  return db
    .select({ countryCode: countryKings.countryCode, country: countries.nameBg, userId: countryKings.userId, username: users.username, tons: countryKings.tons, month: countryKings.month })
    .from(countryKings)
    .innerJoin(users, eq(users.id, countryKings.userId))
    .innerJoin(countries, eq(countries.code, countryKings.countryCode))
    .where(eq(countryKings.month, latest.month))
    .orderBy(countries.nameBg);
}

/** The countries a player is king of right now (for profiles). */
export async function kingdomsOf(db: DbOrTx, userId: string) {
  const [latest] = await db.select({ month: countryKings.month }).from(countryKings).orderBy(desc(countryKings.month)).limit(1);
  if (!latest) return [];
  return db
    .select({ countryCode: countryKings.countryCode, country: countries.nameBg, tons: countryKings.tons })
    .from(countryKings)
    .innerJoin(countries, eq(countries.code, countryKings.countryCode))
    .where(and(eq(countryKings.month, latest.month), eq(countryKings.userId, userId)))
    .orderBy(countries.nameBg);
}

/** This month's race for one country so far (top five). */
export async function kingRace(db: DbOrTx, countryCode: string, now: Date) {
  const w = monthWindow(now);
  return (await countryTons(db, w.startsAt, w.endsAt, countryCode)).slice(0, 5);
}
