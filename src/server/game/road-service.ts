/**
 * 1.4 „Пътна служба“ on the server. Everything lives in job_state:
 * - `pass:<pass>:<day>` = { tons, by: { user: tons }, openedAt? } — salt and sand brought to a closed pass that day;
 * - `pass-load:<contract>` = { pass, day } — which pass a load on the market is for;
 * - `pass-tons:<season>:<user>` = { tons } — „Пазител на прохода“; `pass-guardian-awarded:<season>` once the titles are given.
 * A pass is closed by the weather (`closedByWeather`) until the players bring `ROAD_SERVICE.tonsToOpen`.
 */
import polyline from '@mapbox/polyline';
import { desc, eq, inArray, like, sql } from 'drizzle-orm';
import { featureLive } from '@/lib/game/features';
import { TITLES } from '@/lib/game/first-snow';
import { closedByWeather, goesOver, PASS_GUARDIAN, passById, PASSES, ROAD_SERVICE, type MountainPass } from '@/lib/game/road-service';
import { sofiaDay } from '@/lib/game/shop-v2';
import type { RealConditions } from '@/lib/game/winter';
import { haversineKm, type LatLon } from '@/lib/geo/geometry';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { jobState, seasons, userBadges, users } from '@/server/db/schema';
import type { RoutingProvider } from '@/server/geo/routing';
import { t } from '@/i18n/t';
import { postMoment } from './chat-life';
import { postCoins } from './coins';
import { insertTaggedLoad, loadHubs, type Hub } from './contracts';
import { notify } from './notify';
import { pick } from './random';
import { addPassPoints } from './season-pass';
import { activeSeason } from './seasons';
import { realConditions } from './weather';

interface PassDay { tons: number; by: Record<string, number>; openedAt?: string }

const stateKey = (passId: string, day: string) => `pass:${passId}:${day}`;

/** Every pass today: open, closed by the weather, or opened again by the players (with the tonnes so far). */
export async function passesToday(db: DbOrTx, now: Date, real?: RealConditions | null) {
  const day = sofiaDay(now);
  const conditions = real === undefined ? await realConditions(db, now) : real;
  const rows = await db.select({ key: jobState.key, value: jobState.value }).from(jobState).where(like(jobState.key, `pass:%:${day}`));
  const state = new Map(rows.map((r) => [r.key, r.value as PassDay]));
  return PASSES.map((pass) => {
    const st = state.get(stateKey(pass.id, day));
    const weather = closedByWeather(pass, now, conditions);
    const status: 'open' | 'closed' | 'opened' = !weather ? 'open' : st?.openedAt ? 'opened' : 'closed';
    return { pass, status, tons: Math.round(st?.tons ?? 0), need: ROAD_SERVICE.tonsToOpen };
  });
}

/** The passes closed right now (not opened again today). */
export async function closedPasses(db: DbOrTx, now: Date, real?: RealConditions | null): Promise<MountainPass[]> {
  if (!featureLive('road_service', now)) return [];
  return (await passesToday(db, now, real)).filter((p) => p.status === 'closed').map((p) => p.pass);
}

/** Does this road (an encoded route geometry) go over a pass that is closed now? Its name, or null. */
export async function closedPassOnRoute(db: DbOrTx, geometry: string | null | undefined, now: Date, real?: RealConditions | null): Promise<MountainPass | null> {
  if (!geometry) return null;
  const closed = await closedPasses(db, now, real);
  if (!closed.length) return null;
  const points = polyline.decode(geometry, 6) as LatLon[];
  return closed.find((p) => goesOver(points, p)) ?? null;
}

/** The town under the pass (the loads go there) and the cities the salt can come from. */
function hubsFor(pass: MountainPass, hubs: Hub[]): { town: Hub; suppliers: Hub[] } | null {
  const at: LatLon = [pass.lat, pass.lon];
  const town = hubs
    .map((h) => ({ h, km: haversineKm([h.lat, h.lon], at) }))
    .filter((x) => x.km <= ROAD_SERVICE.townKm)
    .sort((a, b) => a.km - b.km)[0]?.h;
  if (!town) return null;
  const suppliers = hubs
    .filter((h) => h.id !== town.id && h.produces.has('bulk'))
    .map((h) => ({ h, km: haversineKm([h.lat, h.lon], [town.lat, town.lon]) }))
    .filter((x) => x.km >= 30 && x.km <= ROAD_SERVICE.supplierKm)
    .sort((a, b) => a.km - b.km)
    .slice(0, 6)
    .map((x) => x.h);
  return suppliers.length ? { town, suppliers } : null;
}

/** Worker: keeps a few salt and sand loads on the market for every closed pass. */
export async function ensurePassLoads(db: Database, now = new Date(), provider?: RoutingProvider, real?: RealConditions | null): Promise<number> {
  const closed = await closedPasses(db, now, real);
  if (!closed.length) return 0;
  const day = sofiaDay(now);
  const hubs = await loadHubs(db);
  let made = 0;
  for (const pass of closed) {
    const res = await db.execute(sql`
      select count(*)::int as n from job_state j join contracts c on c.id::text = substring(j.key from 11)
      where j.key like 'pass-load:%' and j.value->>'pass' = ${pass.id} and j.value->>'day' = ${day}
        and c.status = 'open' and c.expires_at > ${now}`);
    const have = Number((res.rows[0] as { n?: number } | undefined)?.n ?? 0);
    const where = hubsFor(pass, hubs);
    if (!where) continue;
    for (let i = have; i < ROAD_SERVICE.loadsPerPass; i++) {
      const tons = ROAD_SERVICE.tons[0] + Math.floor(Math.random() * (ROAD_SERVICE.tons[1] - ROAD_SERVICE.tons[0] + 1));
      const id = await insertTaggedLoad(db, pick(where.suppliers), where.town, 'bulk', tons, now, 8 * 3_600_000, ROAD_SERVICE.rewardMultiplier, [], { tag: 'road_service', goods: pick([...ROAD_SERVICE.goods]) }, provider);
      if (!id) continue;
      await db.insert(jobState).values({ key: `pass-load:${id}`, value: { pass: pass.id, day } }).onConflictDoNothing();
      made++;
    }
  }
  return made;
}

async function addTons(tx: Tx, key: string, tons: number, at: Date) {
  await tx
    .insert(jobState)
    .values({ key, value: { tons } })
    .onConflictDoUpdate({ target: jobState.key, set: { value: sql`jsonb_set(${jobState.value}, '{tons}', to_jsonb(coalesce((${jobState.value}->>'tons')::numeric, 0) + ${tons}))`, updatedAt: at } });
}

/** A road-service load arrived: its tonnes go to the pass; at `tonsToOpen` the pass is open for everyone. */
export async function recordPassDelivery(tx: Tx, contractId: string, userId: string, tons: number, at: Date): Promise<'opened' | 'counted' | null> {
  const [link] = await tx.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, `pass-load:${contractId}`));
  if (!link) return null;
  const { pass: passId, day } = link.value as { pass: string; day: string };
  const pass = passById(passId);
  if (!pass) return null;
  const key = stateKey(passId, day);
  await tx.insert(jobState).values({ key, value: { tons: 0, by: {} } }).onConflictDoNothing();
  const [row] = await tx.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, key)).for('update');
  const st = row!.value as PassDay;
  // Once it is open, a late load is paid as any other, but counts for nothing more.
  if (st.openedAt) return null;
  const by = { ...st.by, [userId]: (st.by[userId] ?? 0) + tons };
  const total = st.tons + tons;
  const opened = total >= ROAD_SERVICE.tonsToOpen;
  await tx.update(jobState).set({ value: { tons: total, by, ...(opened ? { openedAt: at.toISOString() } : {}) }, updatedAt: at }).where(eq(jobState.key, key));
  await addPassPoints(tx, userId, Math.round(tons * ROAD_SERVICE.pointsPerTon), at);
  const season = await activeSeason(tx, at);
  await addTons(tx, `pass-tons:${season.id}:${userId}`, tons, at);
  if (opened) {
    // The loads still on the market for this pass are not needed any more.
    await tx.execute(sql`
      update contracts set status = 'expired' where status = 'open' and id::text in (
        select substring(key from 11) from job_state where key like 'pass-load:%' and value->>'pass' = ${passId} and value->>'day' = ${day})`);
    await postMoment(tx, `pass-open:${passId}:${day}`, t('❄️ {0} е отворен отново — благодарение на всички, които докараха сол и пясък.', pass.name), { href: '/game/road-service', button: t('Пътна служба') }, at);
    for (const helper of Object.keys(by)) await notify(tx, helper, 'achievement', () => t('{0} е отворен', pass.name), () => t('Помогна с {0} т. Камионите отново минават през прохода.', Math.round(by[helper]!)), '/game/road-service');
  }
  return opened ? 'opened' : 'counted';
}

/** „Пазител на прохода“: the season's ranking by tonnes brought to closed passes. */
export async function passGuardians(db: DbOrTx, seasonId: number, limit = 10) {
  const rows = await db
    .select({ key: jobState.key, tons: sql<number>`(${jobState.value}->>'tons')::float` })
    .from(jobState)
    .where(like(jobState.key, `pass-tons:${seasonId}:%`))
    .orderBy(desc(sql`(${jobState.value}->>'tons')::float`))
    .limit(limit);
  const ids = rows.map((r) => r.key.split(':')[2]!);
  const names = ids.length ? await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, ids)) : [];
  return rows.map((r, i) => ({ place: i + 1, userId: ids[i]!, username: names.find((n) => n.id === ids[i])?.username ?? '—', tons: Math.round(r.tons) }));
}

/** Worker: when a season is over, the top three of „Пазител на прохода“ get titles and ТрансКоин (once). */
export async function awardPassGuardians(db: Database, now = new Date()) {
  if (!featureLive('road_service', now)) return 0;
  const done = await db.select({ id: seasons.id }).from(seasons).where(eq(seasons.status, 'finished')).orderBy(desc(seasons.id)).limit(3);
  let n = 0;
  for (const s of done) {
    const top = await passGuardians(db, s.id, PASS_GUARDIAN.places.length);
    if (!top.length) continue;
    const [first] = await db.insert(jobState).values({ key: `pass-guardian-awarded:${s.id}`, value: { at: now.toISOString() } }).onConflictDoNothing().returning();
    if (!first) continue;
    await db.transaction(async (tx) => {
      for (const k of top) {
        const prize = PASS_GUARDIAN.places[k.place - 1]!;
        await tx.insert(userBadges).values({ userId: k.userId, badge: prize.title, awardedAt: now }).onConflictDoNothing();
        await postCoins(tx, k.userId, { amount: prize.coins, reason: 'challenge', description: t('Пазител на прохода · място {0}', k.place), idempotencyKey: `pass-guardian:${s.id}:${k.userId}` });
        await notify(tx, k.userId, 'achievement', () => t('Пазител на прохода: място {0}!', k.place), () => t('Титла „{0}“ и {1} TC.', TITLES[prize.title]!.label, prize.coins), '/game/profile');
        n++;
      }
    });
  }
  return n;
}

/** The road-service loads on the market now, by pass (for the page). */
export async function passLoads(db: DbOrTx, now: Date) {
  const day = sofiaDay(now);
  const res = await db.execute(sql`
    select j.value->>'pass' as pass, count(*)::int as n from job_state j join contracts c on c.id::text = substring(j.key from 11)
    where j.key like 'pass-load:%' and j.value->>'day' = ${day} and c.status = 'open' and c.expires_at > ${now}
    group by 1`);
  return new Map((res.rows as { pass: string; n: number }[]).map((r) => [r.pass, Number(r.n)]));
}

