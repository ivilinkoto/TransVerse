/**
 * 1.2.3 „Здраве на играта“: one admin page with what matters right now —
 * players today, trips in 24 h, and per country the open loads and the idle
 * trucks. A country with idle trucks and no loads for over an hour is posted
 * to #сигнали (staff) once a day.
 */
import { and, eq, gt, gte, isNull, sql } from 'drizzle-orm';
import { featureLive } from '@/lib/game/features';
import { sofiaDay } from '@/lib/game/shop-v2';
import type { Database, DbOrTx } from '@/server/db/client';
import { cities, contracts, countries, deliveries, jobState, users, vehicles } from '@/server/db/schema';
import { appUrl } from '@/server/discord/config';
import { announce } from '@/server/discord/outbox';
import { t } from '@/i18n/t';

export const HEALTH = { starvedAfterMs: 60 * 60_000 } as const;

export interface CountryHealth { code: string; name: string; openLoads: number; idleTrucks: number; starved: boolean }

/** Open public loads and idle trucks per country (only countries with either). */
export async function countryHealth(db: DbOrTx, now: Date): Promise<CountryHealth[]> {
  const [loads, idle, names] = await Promise.all([
    db
      .select({ code: cities.countryCode, n: sql<number>`count(*)::int` })
      .from(contracts)
      .innerJoin(cities, eq(cities.id, contracts.originCityId))
      .where(and(eq(contracts.status, 'open'), gt(contracts.expiresAt, now), isNull(contracts.tradeCompanyId), isNull(contracts.tenderId), isNull(contracts.clientContractId), isNull(contracts.auctionId), isNull(contracts.constructionId), isNull(contracts.sharedLoadId)))
      .groupBy(cities.countryCode),
    db
      .select({ code: cities.countryCode, n: sql<number>`count(*)::int` })
      .from(vehicles)
      .innerJoin(cities, eq(cities.id, vehicles.cityId))
      .where(and(eq(vehicles.status, 'idle'), isNull(vehicles.soldAt)))
      .groupBy(cities.countryCode),
    db.select({ code: countries.code, name: countries.nameBg }).from(countries),
  ]);
  const name = new Map(names.map((c) => [c.code, c.name]));
  const open = new Map(loads.map((r) => [r.code, r.n]));
  const trucks = new Map(idle.map((r) => [r.code, r.n]));
  return [...new Set([...open.keys(), ...trucks.keys()])]
    .map((code) => ({ code, name: name.get(code) ?? code, openLoads: open.get(code) ?? 0, idleTrucks: trucks.get(code) ?? 0, starved: (trucks.get(code) ?? 0) > 0 && !open.get(code) }))
    .sort((a, b) => Number(b.starved) - Number(a.starved) || b.idleTrucks - a.idleTrucks);
}

export async function gameHealth(db: DbOrTx, now: Date) {
  const day = new Date(now.getTime() - 86_400_000);
  const [[active], [trips], byCountry] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(users).where(gte(users.lastSeenAt, day)),
    db.select({ n: sql<number>`count(*)::int`, cents: sql<number>`coalesce(sum(${deliveries.payoutCents}), 0)::bigint` }).from(deliveries).where(and(eq(deliveries.status, 'completed'), gte(deliveries.completedAt, day))),
    countryHealth(db, now),
  ]);
  return { activePlayers: active?.n ?? 0, trips: trips?.n ?? 0, tripCents: Number(trips?.cents ?? 0), countries: byCountry, starved: byCountry.filter((c) => c.starved) };
}

/**
 * Worker: remembers since when each country has idle trucks and no loads
 * (job_state `starved:<cc>`) and posts to #сигнали once that passes an hour
 * (once per country a day).
 */
export async function starvedCountryAlerts(db: Database, now = new Date()) {
  if (!featureLive('staff_alerts', now)) return 0;
  const list = await countryHealth(db, now);
  let sent = 0;
  for (const c of list) {
    const key = `starved:${c.code}`;
    if (!c.starved) { await db.delete(jobState).where(eq(jobState.key, key)); continue; }
    await db.insert(jobState).values({ key, value: { since: now.toISOString() } }).onConflictDoNothing();
    const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, key));
    const since = new Date((row?.value as { since?: string } | undefined)?.since ?? now.toISOString());
    if (now.getTime() - since.getTime() < HEALTH.starvedAfterMs) continue;
    const hours = Math.floor((now.getTime() - since.getTime()) / 3_600_000);
    await announce(db, `staff-alert:starved:${c.code}:${sofiaDay(now)}`, 'staffAlerts', () => ({
      embeds: [{ title: t('🚚 Камиони без товари: {0}', c.name), description: t('{0} свободни камиона в {1} и нито един отворен товар вече {2} ч.', c.idleTrucks, c.name, Math.max(1, hours)), url: `${appUrl()}/admin/health`, color: 0xf97316, footer: { text: 'TransVerse · сигнал за екипа' } }],
    }), now);
    sent++;
  }
  return sent;
}
