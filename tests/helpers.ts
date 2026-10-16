import { eq, sql } from 'drizzle-orm';
import { register } from '@/server/auth/accounts';
import { getDb } from '@/server/db/client';
import { cities, companies, contracts, routes, users } from '@/server/db/schema';
import { foundCompany } from '@/server/game/company';
import { post } from '@/server/game/finance';
import { getRoute } from '@/server/geo/route-service';
import { approximateProvider } from '@/server/geo/routing';

export const db = () => getDb();

let counter = 0;
/** A freshly registered player: an independent driver with a rented truck. */
export async function newPlayer(start = 'Sofia') {
  counter++;
  const city = await cityByName(start);
  const tag = `${Date.now().toString(36)}${counter}`;
  const username = `player_${tag}`.slice(0, 20);
  const userId = await register(db(), { email: `p${tag}@example.com`, username, password: 'correct horse battery', startCityId: city.id });
  return { userId, hq: city, username };
}

/** Meets the founding criteria (via real ledger postings) and founds a company. */
export async function playerWithCompany(start = 'Sofia', extraCents = 0) {
  const p = await newPlayer(start);
  await db().update(users).set({ level: 2, xp: 800 }).where(eq(users.id, p.userId));
  const [company] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
  await db().update(companies).set({ deliveries: 3 }).where(eq(companies.id, company!.id));
  await db().transaction((tx) => post(tx, company!.id, [{ category: 'admin_adjustment', amountCents: 5_000_00 + extraCents, description: 'test funds', idempotencyKey: `test:${company!.id}` }]));
  await foundCompany(db(), p.userId, { name: `Тест ${p.username}`, hqCityId: p.hq.id });
  return p;
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
