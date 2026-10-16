/**
 * Loads data/geo/launch-region.json (real GeoNames data) into the database and
 * derives the simulated city markets. Idempotent — safe to run on every deploy.
 */
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { deriveMarketProfile, isFreightHub } from '../src/lib/game/markets';
import { closeDb, getDb } from '../src/server/db/client';
import { cities, cityMarkets, countries, ports } from '../src/server/db/schema';

interface Dataset {
  countries: { code: string; iso3: string; nameEn: string; nameBg: string; continent: string; geonameId: number }[];
  cities: { id: number; name: string; nameBg: string; country: string; region: string | null; regionBg: string | null; lat: number; lon: number; population: number; timezone: string }[];
  ports: { id: number; name: string; nameBg: string | null; country: string; lat: number; lon: number; cityId: number }[];
}

export async function importGeo(file = 'data/geo/launch-region.json') {
  const data = JSON.parse(readFileSync(file, 'utf8')) as Dataset;
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .insert(countries)
      .values(data.countries)
      .onConflictDoUpdate({ target: countries.code, set: { nameEn: sql`excluded.name_en`, nameBg: sql`excluded.name_bg` } });

    for (let i = 0; i < data.cities.length; i += 500) {
      const chunk = data.cities.slice(i, i + 500).map((c) => ({
        id: c.id, countryCode: c.country, name: c.name, nameBg: c.nameBg, region: c.region, regionBg: c.regionBg,
        lat: c.lat, lon: c.lon, population: c.population, timezone: c.timezone,
      }));
      await tx.insert(cities).values(chunk).onConflictDoUpdate({
        target: cities.id,
        set: { name: sql`excluded.name`, nameBg: sql`excluded.name_bg`, population: sql`excluded.population`, lat: sql`excluded.lat`, lon: sql`excluded.lon`, region: sql`excluded.region`, regionBg: sql`excluded.region_bg` },
      });
    }

    await tx
      .insert(ports)
      .values(data.ports.map((p) => ({ id: p.id, name: p.name, nameBg: p.nameBg, countryCode: p.country, cityId: p.cityId, lat: p.lat, lon: p.lon })))
      .onConflictDoNothing();

    // Simulated markets: insert missing rows only, never reset live demand.
    const portCities = new Set(data.ports.map((p) => p.cityId));
    const rows = data.cities
      .filter((c) => isFreightHub(c))
      .flatMap((c) => deriveMarketProfile(c, portCities.has(c.id)).map((m) => ({ cityId: c.id, ...m })));
    for (let i = 0; i < rows.length; i += 1000) await tx.insert(cityMarkets).values(rows.slice(i, i + 1000)).onConflictDoNothing();
    console.log(`countries=${data.countries.length} cities=${data.cities.length} ports=${data.ports.length} marketRows=${rows.length}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await importGeo(process.argv[2]);
  await closeDb();
}
