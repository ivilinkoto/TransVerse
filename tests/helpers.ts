import { eq, sql } from 'drizzle-orm';
import { register } from '@/server/auth/accounts';
import { getDb } from '@/server/db/client';
import { cities, contracts, routes } from '@/server/db/schema';
import { getRoute } from '@/server/geo/route-service';
import { approximateProvider } from '@/server/geo/routing';

export const db = () => getDb();

let counter = 0;
export async function newPlayer(hq = 'Sofia') {
  counter++;
  const city = await cityByName(hq);
  const tag = `${Date.now().toString(36)}${counter}`;
  const userId = await register(db(), {
    email: `p${tag}@example.com`,
    username: `player_${tag}`.slice(0, 20),
    password: 'correct horse battery',
    companyName: `Тест ${tag}`,
    hqCityId: city.id,
  });
  return { userId, hq: city };
}

export async function cityByName(name: string) {
  const [city] = await db().select().from(cities).where(sql`${cities.name} = ${name}`).orderBy(sql`${cities.population} desc`).limit(1);
  if (!city) throw new Error(`city ${name} not in dataset`);
  return city;
}

/** Inserts a known contract so tests do not depend on the random market. */
export async function makeContract(from: string, to: string, overrides: Partial<typeof contracts.$inferInsert> = {}) {
  const a = await cityByName(from);
  const b = await cityByName(to);
  const route = await getRoute(db(), a.id, b.id, 'truck', approximateProvider);
  const [contract] = await db()
    .insert(contracts)
    .values({
      shipper: 'Тест ООД', goods: 'Мебели', cargoType: 'pallets', weightTons: 1, originCityId: a.id, destCityId: b.id,
      routeId: route.id, distanceKm: route.distanceKm, rewardCents: 500_00, windowMinutes: 48 * 60, minLevel: 1,
      expiresAt: new Date(Date.now() + 86_400_000), ...overrides,
    })
    .returning();
  return contract!;
}

export async function routeById(id: number) {
  const [r] = await db().select().from(routes).where(eq(routes.id, id));
  return r!;
}
