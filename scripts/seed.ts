/**
 * Warms the world after import: showcase routes, an active season and an
 * initial freight market. Idempotent; uses the configured routing provider.
 */
import { closeDb, getDb } from '../src/server/db/client';
import { replenishMarket } from '../src/server/game/contracts';
import { activeSeason } from '../src/server/game/seasons';
import { getRoute } from '../src/server/geo/route-service';
import { showcaseRoutes } from '../src/server/showcase';

const db = getDb();
for (const r of await showcaseRoutes()) {
  const route = await getRoute(db, r.from.id, r.to.id, 'truck');
  console.log(`${r.from.name} → ${r.to.name}: ${route.distanceKm} km (${route.provider})`);
}
await activeSeason(db);
let created = 0;
for (let i = 0; i < Number(process.argv[2] ?? 4); i++) created += await replenishMarket(db);
console.log(`contracts created: ${created}`);
await closeDb();
