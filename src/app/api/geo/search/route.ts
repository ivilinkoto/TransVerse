import { and, desc, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { playableCountries } from '@/lib/geo/scope';
import { getDb } from '@/server/db/client';
import { cities } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { handler } from '@/server/http';

const Query = z.object({ q: z.string().trim().min(2).max(40) });

/** 1.2.3.3: cities by name (Bulgarian or Latin), the biggest first, only in the countries open to the player. */
export const GET = handler({ schema: Query, perMinute: 120 }, async ({ input, user }) => {
  const db = getDb();
  const countries = playableCountries(await featureFor(db, user.id, 'europe'), await featureFor(db, user.id, 'open_world'));
  const like = `${input.q.replace(/[%_\\]/g, '')}%`;
  const rows = await db
    .select({ id: cities.id, name: cities.nameBg, country: cities.countryCode, lat: cities.lat, lon: cities.lon })
    .from(cities)
    .where(and(inArray(cities.countryCode, [...countries]), or(sql`${cities.nameBg} ilike ${like}`, sql`${cities.name} ilike ${like}`)))
    .orderBy(desc(cities.population))
    .limit(8);
  return { cities: rows };
});
