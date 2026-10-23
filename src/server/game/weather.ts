import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { featureLive } from '@/lib/game/features';
import { featureFor } from '@/server/features';
import { GAME_COUNTRIES } from '@/lib/geo/scope';
import { CONDITION_RANK, conditionFromWeather, type RealConditions, type RoadCondition } from '@/lib/game/winter';
import type { Database, DbOrTx } from '@/server/db/client';
import { cities, weatherNow } from '@/server/db/schema';

/**
 * Real weather on the roads (v1.4): every half hour the worker reads the
 * weather now (Open-Meteo, CC BY 4.0) in the three biggest cities of every
 * country, and the road conditions follow it — snow, ice and blizzards when
 * it really snows or freezes, any time of the year. Readings older than three
 * hours are not used (the game's winter model takes over).
 */

export const WEATHER = { citiesPerCountry: 3, freshMs: 3 * 3_600_000, attribution: 'Времето: Open-Meteo.com (CC BY 4.0)' } as const;

interface OpenMeteoCurrent {
  current?: { temperature_2m: number; precipitation: number; snowfall: number; weather_code: number; wind_gusts_10m: number };
}

/** Worker: fetches the weather now for the sample cities (one request). */
export async function fetchWeather(db: Database, now = new Date(), fetcher: typeof fetch = fetch) {
  const points = await db.execute<{ id: number; country: string; lat: number; lon: number }>(sql`
    select id, country_code as country, lat, lon from (
      select c.*, row_number() over (partition by country_code order by population desc) as n from ${cities} c
      where country_code in (${sql.join(GAME_COUNTRIES.map((c) => sql`${c}`), sql`, `)})
    ) t where n <= ${WEATHER.citiesPerCountry}`);
  const rows = points.rows;
  if (!rows.length) return 0;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${rows.map((r) => r.lat.toFixed(3)).join(',')}&longitude=${rows.map((r) => r.lon.toFixed(3)).join(',')}&current=temperature_2m,precipitation,snowfall,weather_code,wind_gusts_10m&timezone=UTC`;
  const response = await fetcher(url, { signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'TransVerse (game)' } });
  if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
  const body = (await response.json()) as OpenMeteoCurrent | OpenMeteoCurrent[];
  const list = Array.isArray(body) ? body : [body];
  let n = 0;
  for (const [i, r] of rows.entries()) {
    const c = list[i]?.current;
    if (!c) continue;
    const reading = { tempC: c.temperature_2m, precipMm: c.precipitation ?? 0, snowCm: c.snowfall ?? 0, gustKmh: c.wind_gusts_10m ?? 0, code: c.weather_code ?? 0 };
    const values = { cityId: r.id, countryCode: r.country, ...reading, condition: conditionFromWeather(reading), fetchedAt: now };
    await db.insert(weatherNow).values(values).onConflictDoUpdate({ target: weatherNow.cityId, set: values });
    n++;
  }
  return n;
}

/** The road condition of every country from fresh readings (the worst of its cities); null before the release or without data. */
export async function realConditions(db: DbOrTx, now = new Date(), staff = false): Promise<RealConditions | null> {
  if (!featureLive('real_weather', now, staff)) return null;
  return readConditions(db, now);
}

/** The same for a player (staff see it before the release). */
export async function realConditionsFor(db: DbOrTx, userId: string, now = new Date()): Promise<RealConditions | null> {
  return (await featureFor(db, userId, 'real_weather', now)) ? readConditions(db, now) : null;
}

async function readConditions(db: DbOrTx, now: Date): Promise<RealConditions | null> {
  const rows = await db.select({ country: weatherNow.countryCode, condition: weatherNow.condition }).from(weatherNow).where(gt(weatherNow.fetchedAt, new Date(now.getTime() - WEATHER.freshMs)));
  if (!rows.length) return null;
  const out: RealConditions = {};
  for (const r of rows) {
    const c = r.condition as RoadCondition;
    if (!out[r.country] || CONDITION_RANK[c] > CONDITION_RANK[out[r.country]!]) out[r.country] = c;
  }
  return out;
}

/** The readings for the dashboard (city, temperature, condition). */
export async function weatherReadings(db: DbOrTx, countries: string[]) {
  if (!countries.length) return [];
  return db
    .select({ cityId: weatherNow.cityId, name: cities.nameBg, country: weatherNow.countryCode, tempC: weatherNow.tempC, condition: weatherNow.condition, fetchedAt: weatherNow.fetchedAt })
    .from(weatherNow)
    .innerJoin(cities, eq(cities.id, weatherNow.cityId))
    .where(and(inArray(weatherNow.countryCode, countries)))
    .orderBy(desc(weatherNow.fetchedAt));
}
