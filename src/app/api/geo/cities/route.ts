import { and, between, gte, inArray, sql } from 'drizzle-orm';
import { featureLive } from '@/lib/game/features';
import { playableCountries } from '@/lib/geo/scope';
import { isStaff } from '@/server/auth/roles';
import { z } from 'zod';
import { getDb } from '@/server/db/client';
import { cities, cityMarkets, contracts } from '@/server/db/schema';
import { handler } from '@/server/http';

const Query = z.object({
  bbox: z.string().regex(/^-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+$/),
  zoom: z.coerce.number().min(0).max(22),
});

/** Population threshold by zoom keeps the payload small: never the whole world at once. */
const minPopulation = (zoom: number) => (zoom < 4.5 ? 700_000 : zoom < 5.5 ? 200_000 : zoom < 6.5 ? 60_000 : 15_000);

export const GET = handler({ schema: Query, perMinute: 240 }, async ({ input, user }) => {
  // "Цяла Европа" (v1.7) and the east (v2.0): the new countries show on the map from the release (the staff see them earlier).
  const countries = playableCountries(featureLive('europe', new Date(), isStaff(user.role)), featureLive('open_world', new Date(), isStaff(user.role)));
  const [minLon, minLat, maxLon, maxLat] = input.bbox.split(',').map(Number) as [number, number, number, number];
  const db = getDb();
  const rows = await db
    .select({
      id: cities.id,
      name: cities.nameBg,
      country: cities.countryCode,
      population: cities.population,
      lat: cities.lat,
      lon: cities.lon,
      hub: sql<boolean>`exists (select 1 from ${cityMarkets} m where m.city_id = "cities"."id")`,
      open: sql<number>`(select count(*) from ${contracts} c where c.origin_city_id = "cities"."id" and c.status = 'open' and c.tender_id is null and c.expires_at > now())::int`,
    })
    .from(cities)
    .where(and(between(cities.lat, minLat, maxLat), between(cities.lon, minLon, maxLon), gte(cities.population, minPopulation(input.zoom)), inArray(cities.countryCode, [...countries])))
    .orderBy(sql`${cities.population} desc`)
    .limit(600);
  return {
    type: 'FeatureCollection',
    features: rows.map((c) => ({ type: 'Feature', id: c.id, geometry: { type: 'Point', coordinates: [c.lon, c.lat] }, properties: { id: c.id, name: c.name, country: c.country, population: c.population, hub: c.hub, open: c.open } })),
  };
});
