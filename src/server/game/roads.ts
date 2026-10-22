import { and, count, eq, gt, lte } from 'drizzle-orm';
import { islandOf } from '@/lib/game/crossings';
import { MOTORWAYS, OVERSIZE, ROAD_WORKS } from '@/lib/game/roads';
import { haversineKm } from '@/lib/geo/geometry';
import type { Database, DbOrTx } from '@/server/db/client';
import { contracts, roadWorks } from '@/server/db/schema';
import type { RoutingProvider } from '@/server/geo/routing';
import { addLoad, loadHubs } from './contracts';
import { broadcast } from './notify';
import { pick, rand, randInt } from './random';

/** Road works going on now (v1.5). */
export async function activeRoadWorks(db: DbOrTx, now = new Date()) {
  return db.select().from(roadWorks).where(and(lte(roadWorks.startsAt, now), gt(roadWorks.endsAt, now)));
}

/** Worker: now and then works start on a real motorway (at most a few at a time). */
export async function ensureRoadWorks(db: Database, now = new Date()) {
  const active = await activeRoadWorks(db, now);
  if (active.length >= ROAD_WORKS.max) return null;
  // One new site at most every few hours.
  const [recent] = await db.select({ id: roadWorks.id }).from(roadWorks).where(gt(roadWorks.startsAt, new Date(now.getTime() - ROAD_WORKS.everyHours * 3_600_000))).limit(1);
  if (recent) return null;
  const countries = Object.keys(MOTORWAYS).filter((c) => !active.some((a) => a.countryCode === c));
  if (!countries.length) return null;
  const country = pick(countries);
  const days = randInt(ROAD_WORKS.days[0], ROAD_WORKS.days[1]);
  const delay = Math.round((ROAD_WORKS.delay[0] + rand() * (ROAD_WORKS.delay[1] - ROAD_WORKS.delay[0])) * 100) / 100;
  const [row] = await db.insert(roadWorks).values({ countryCode: country, road: pick(MOTORWAYS[country]!), delay, startsAt: now, endsAt: new Date(now.getTime() + days * 86_400_000), createdAt: now }).returning();
  await broadcast(db, 'market');
  return row!;
}

/** Worker: keeps a few oversize loads on the board between big cities. */
export async function ensureOversizeLoads(db: Database, now = new Date(), provider?: RoutingProvider) {
  const [open] = await db.select({ n: count() }).from(contracts).where(and(eq(contracts.oversize, true), eq(contracts.status, 'open'), gt(contracts.expiresAt, now)));
  const missing = OVERSIZE.open - (open?.n ?? 0);
  if (missing <= 0) return 0;
  const hubs = (await loadHubs(db)).filter((h) => h.population >= 150_000 && !islandOf(h));
  let made = 0;
  for (let i = 0; i < missing * 3 && made < missing; i++) {
    const a = pick(hubs);
    const fits = hubs.filter((b) => {
      const km = haversineKm([a.lat, a.lon], [b.lat, b.lon]) * 1.25;
      return b.id !== a.id && km >= OVERSIZE.minKm && km <= OVERSIZE.maxKm;
    });
    if (!fits.length) continue;
    const b = pick(fits);
    const tons = randInt(OVERSIZE.tons[0], OVERSIZE.tons[1]);
    if (await addLoad(db, a.id, b.id, 'special', tons, now, OVERSIZE.hours * 3_600_000, OVERSIZE.multiplier, { oversize: true, goods: pick(OVERSIZE.goods) }, provider, hubs)) made++;
  }
  if (made) await broadcast(db, 'market');
  return made;
}
