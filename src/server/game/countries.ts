import { aliasedTable, and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { ECONOMY } from '@/lib/game/economy';
import { LOW_EMISSION_ZONES, TOLL_FACTOR, TOLL_VIGNETTE_CENTS } from '@/lib/game/europe-roads';
import { fuelPriceCents } from '@/lib/game/fuel';
import { NATIONAL_DAYS } from '@/lib/game/spring';
import type { DbOrTx } from '@/server/db/client';
import { cities, cityVisits, contracts, countries } from '@/server/db/schema';
import { currentKings, kingRace } from './kings';

const origin = aliasedTable(cities, 'origin');

/**
 * One country of the game in short (v1.7): today's diesel, the truck toll,
 * low-emission zones, the national day, its king and the
 * best open loads into it. Game data; shared by the country page and /държава.
 */
export async function countryInfo(db: DbOrTx, code: string, now: Date, viewerId?: string | null) {
  const [country] = await db.select({ code: countries.code, name: countries.nameBg }).from(countries).where(eq(countries.code, code.toUpperCase()));
  if (!country) return null;
  const zoneIds = Object.keys(LOW_EMISSION_ZONES).map(Number);
  const [zones, loads, king, race, cityCount, visited] = await Promise.all([
    db.select({ name: cities.nameBg }).from(cities).where(and(inArray(cities.id, zoneIds), eq(cities.countryCode, country.code))),
    db
      .select({ id: contracts.id, goods: contracts.goods, tons: contracts.weightTons, rewardCents: contracts.rewardCents, km: contracts.distanceKm, from: origin.nameBg, to: cities.nameBg })
      .from(contracts)
      .innerJoin(cities, eq(cities.id, contracts.destCityId))
      .innerJoin(origin, eq(origin.id, contracts.originCityId))
      .where(and(
        eq(contracts.status, 'open'), eq(contracts.shady, false), gt(contracts.expiresAt, now), eq(cities.countryCode, country.code),
        // Only loads anyone may take.
        isNull(contracts.tenderId), isNull(contracts.rallyId), isNull(contracts.factoryOrgId), isNull(contracts.branchOrgId), isNull(contracts.sharedLoadId), isNull(contracts.reservedByCompanyId),
      ))
      .orderBy(desc(contracts.rewardCents))
      .limit(5),
    currentKings(db).then((ks) => ks.find((k) => k.countryCode === country.code) ?? null),
    kingRace(db, country.code, now),
    db.select({ n: sql<number>`count(*)::int` }).from(cities).where(eq(cities.countryCode, country.code)).then((r) => r[0]?.n ?? 0),
    viewerId
      ? db.select({ n: sql<number>`count(*)::int` }).from(cityVisits).innerJoin(cities, eq(cities.id, cityVisits.cityId)).where(and(eq(cityVisits.userId, viewerId), eq(cities.countryCode, country.code))).then((r) => r[0]?.n ?? 0)
      : null,
  ]);
  const vignette = TOLL_VIGNETTE_CENTS[country.code];
  return {
    ...country,
    fuelCents: fuelPriceCents(country.code, now),
    toll: vignette ? { kind: 'vignette' as const, cents: vignette } : { kind: 'km' as const, centsPerKm: Math.round(ECONOMY.tollCentsPerKm * (TOLL_FACTOR[country.code] ?? 1) * 10) / 10 },
    zones: zones.map((z) => z.name),
    nationalDay: NATIONAL_DAYS[country.code] ?? null,
    king,
    race,
    loads,
    cities: cityCount,
    visited,
  };
}

export type CountryInfo = NonNullable<Awaited<ReturnType<typeof countryInfo>>>;

/** A country by its code or its name (Bulgarian or English). */
export async function findCountry(db: DbOrTx, q: string) {
  const s = q.trim();
  if (!s) return null;
  const [c] = await db.select({ code: countries.code }).from(countries).where(sql`upper(${countries.code}) = upper(${s}) or ${countries.nameBg} ilike ${s} or ${countries.nameEn} ilike ${s}`).limit(1);
  if (c) return c.code;
  const [part] = await db.select({ code: countries.code }).from(countries).where(sql`${countries.nameBg} ilike ${`%${s.replace(/[%_]/g, '')}%`}`).limit(1);
  return part?.code ?? null;
}
