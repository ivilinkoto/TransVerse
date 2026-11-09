/**
 * 1.2.3.5 „Гараж“: tuning bought in лв. (looks only), saved tuning sets, the truck's
 * history, the retro shelf, and friends visiting the garage (a like and a note).
 */
import { and, desc, eq, isNotNull, like, sql } from 'drizzle-orm';
import { UPGRADES, powerUnitModel, trailerModel } from '@/lib/game/catalog';
import { maintenanceCostCents, maintenanceState } from '@/lib/game/maintenance';
import { repairPlan } from '@/lib/game/repair';
import type { Cosmetics } from '@/lib/game/cosmetics';
import { GARAGE, TUNING_PARTS, fitsKind, hallIsNight, hallTier, ownedKey, truckStats, tuningStyle, type Tuning, type TuningPart } from '@/lib/game/garage';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companies, contracts, deliveries, inventoryItems, jobState, userBadges, users, vehicles } from '@/server/db/schema';
import { postGameLine } from './chat-life';
import { companyForUser } from './company';
import { fail } from './errors';
import { post } from './finance';
import { notify } from './notify';
import { fleetView } from './queries';
import { t as tr } from '@/i18n/t';

async function myTruck(tx: Tx, userId: string, vehicleId: string) {
  const company = await companyForUser(tx, userId);
  const [v] = await tx.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.companyId, company.id), sql`${vehicles.soldAt} is null`)).for('update');
  if (!v) fail('vehicle_not_found', tr('Превозното средство не е намерено.'), 404);
  if (v!.ownership !== 'owned') fail('rented', tr('Наетите и фирмените превозни средства не могат да се модифицират.'));
  return { company, v: v! };
}

const isPart = (p: string): p is TuningPart => p in TUNING_PARTS;

/** Fits a tuning style: paid once per truck, free when it was bought before. `style: null` takes the part off. */
export async function fitTuning(db: Database, userId: string, vehicleId: string, part: string, style: string | null) {
  if (!isPart(part)) fail('invalid_part', tr('Изберете част и стил.'));
  return db.transaction(async (tx) => {
    const { company, v } = await myTruck(tx, userId, vehicleId);
    const cos: Cosmetics = v.cosmetics ?? {};
    const tuning: Tuning = { ...(cos.tuning ?? {}) };
    const owned = new Set(cos.owned ?? []);
    let paidCents = 0;
    if (style === null) {
      delete tuning[part as TuningPart];
    } else {
      const def = tuningStyle(part as TuningPart, style);
      if (!def) fail('invalid_part', tr('Изберете част и стил.'));
      if (!fitsKind(part as TuningPart, powerUnitModel(v.modelId).kind)) fail('not_applicable', tr('Тази част не става за този тип превозно средство.'));
      if (tuning[part as TuningPart] === style) fail('already_fitted', tr('Камионът вече е с тази част.'));
      const key = ownedKey(part as TuningPart, style);
      if (!owned.has(key)) {
        paidCents = def!.priceCents;
        await post(tx, company.id, [{ category: 'upgrades', amountCents: -paidCents, description: tr('Тунинг: {0} ({1}) — {2}', TUNING_PARTS[part as TuningPart].label, def!.label, v.plate), idempotencyKey: `tuning:${v.id}:${key}`, refType: 'vehicle', refId: v.id }], { requireFunds: true });
        owned.add(key);
      }
      tuning[part as TuningPart] = style;
    }
    await tx.update(vehicles).set({ cosmetics: { ...cos, tuning, owned: [...owned] } }).where(eq(vehicles.id, v.id));
    return { paidCents, tuning };
  });
}

/** Saves the tuning on the truck now as set `slot` (0–2). */
export async function saveTuningPreset(db: Database, userId: string, vehicleId: string, slot: number, name: string) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= GARAGE.presets) fail('invalid_slot', tr('Няма такова място.'));
  const clean = name.trim().slice(0, GARAGE.presetName) || tr('Сглобка {0}', slot + 1);
  return db.transaction(async (tx) => {
    const { v } = await myTruck(tx, userId, vehicleId);
    const cos: Cosmetics = v.cosmetics ?? {};
    const presets = [...(cos.presets ?? [])];
    while (presets.length < slot) presets.push({ name: tr('Сглобка {0}', presets.length + 1), tuning: {} });
    presets[slot] = { name: clean, tuning: { ...(cos.tuning ?? {}) } };
    await tx.update(vehicles).set({ cosmetics: { ...cos, presets } }).where(eq(vehicles.id, v.id));
    return { name: clean };
  });
}

/** Puts a saved set back on — only the styles this truck owns; the rest are left off. */
export async function applyTuningPreset(db: Database, userId: string, vehicleId: string, slot: number) {
  return db.transaction(async (tx) => {
    const { v } = await myTruck(tx, userId, vehicleId);
    const cos: Cosmetics = v.cosmetics ?? {};
    const preset = cos.presets?.[slot];
    if (!preset) fail('no_preset', tr('Тази сглобка е празна.'));
    const owned = new Set(cos.owned ?? []);
    const tuning: Tuning = {};
    let missing = 0;
    for (const [p, s] of Object.entries(preset!.tuning) as [TuningPart, string][]) {
      if (owned.has(ownedKey(p, s))) tuning[p] = s;
      else missing++;
    }
    await tx.update(vehicles).set({ cosmetics: { ...cos, tuning } }).where(eq(vehicles.id, v.id));
    return { missing };
  });
}

const likeKey = (ownerId: string, visitorId: string) => `garage-like:${ownerId}:${visitorId}`;

/** A visitor's 👍 (and an optional note) in another player's garage. The owner hears about the first one. */
export async function likeGarage(db: Database, visitorId: string, ownerUsername: string, note = '', now = new Date()) {
  const [owner] = await db.select({ id: users.id, username: users.username }).from(users).where(sql`lower(${users.username}) = lower(${ownerUsername}) and ${users.bannedAt} is null`);
  if (!owner) fail('player_not_found', tr('Няма такъв играч.'), 404);
  if (owner!.id === visitorId) fail('own_garage', tr('Това е твоят гараж.'));
  const text = note.trim().slice(0, GARAGE.noteChars);
  return db.transaction(async (tx) => {
    const key = likeKey(owner!.id, visitorId);
    const [before] = await tx.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, key)).for('update');
    const value = { at: now.toISOString(), note: text || ((before?.value as { note?: string } | undefined)?.note ?? '') };
    await tx.insert(jobState).values({ key, value, updatedAt: now }).onConflictDoUpdate({ target: jobState.key, set: { value, updatedAt: now } });
    if (!before || (text && text !== (before.value as { note?: string }).note)) {
      const [me] = await tx.select({ username: users.username }).from(users).where(eq(users.id, visitorId));
      await notify(tx, owner!.id, 'info', () => tr('👍 {0} хареса гаража ти', me?.username ?? ''), () => (text ? `„${text}“` : tr('Мина през гаража ти и остави 👍.')), '/game/showroom');
    }
    return { first: !before };
  });
}

/** 1.2.3.6: the 👍 of a garage for the player's profile — how many, and the latest notes. */
export async function garageLikes(db: DbOrTx, ownerId: string, notes = 3) {
  const [{ count = 0 } = {}] = await db.select({ count: sql<number>`count(*)::int` }).from(jobState).where(like(jobState.key, `garage-like:${ownerId}:%`));
  if (!count) return { count: 0, latest: [] as { username: string; note: string }[] };
  const rows = await db
    .select({ username: users.username, value: jobState.value })
    .from(jobState)
    .innerJoin(users, sql`${users.id}::text = split_part(${jobState.key}, ':', 3)`)
    .where(and(like(jobState.key, `garage-like:${ownerId}:%`), sql`coalesce(${jobState.value}->>'note', '') <> ''`))
    .orderBy(desc(jobState.updatedAt))
    .limit(notes);
  return { count, latest: rows.map((r) => ({ username: r.username, note: (r.value as { note?: string }).note ?? '' })) };
}

/** Shows the garage in the global chat (once in a few hours). */
export async function shareGarage(db: Database, userId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const key = `garage-share:${userId}`;
    const [row] = await tx.select({ updatedAt: jobState.updatedAt }).from(jobState).where(eq(jobState.key, key)).for('update');
    if (row && now.getTime() - row.updatedAt.getTime() < GARAGE.shareEveryHours * 3_600_000) fail('too_soon', tr('Гаражът вече е в чата — пак след {0} ч.', GARAGE.shareEveryHours));
    const [me] = await tx.select({ username: users.username }).from(users).where(eq(users.id, userId));
    await tx.insert(jobState).values({ key, value: {}, updatedAt: now }).onConflictDoUpdate({ target: jobState.key, set: { updatedAt: now } });
    await postGameLine(tx, 'global', 'garage', tr('🏁 {0} отвори гаража си за гости. Влез, разгледай камионите и остави 👍!', me!.username), { href: `/game/showroom/u/${encodeURIComponent(me!.username)}`, button: tr('Влез в гаража') }, now);
    return { ok: true };
  });
}

/** Per truck: deliveries, km, the longest trip and the city it went to most. */
async function truckHistory(db: DbOrTx, vehicleIds: string[]) {
  if (!vehicleIds.length) return new Map<string, { trips: number; km: number; longestKm: number; favouriteCity: string | null }>();
  const ids = sql.join(vehicleIds.map((id) => sql`${id}::uuid`), sql`, `);
  const rows = await db
    .select({ vehicleId: deliveries.vehicleId, trips: sql<number>`count(*)::int`, km: sql<number>`coalesce(sum(${deliveries.loadedKm} + ${deliveries.emptyKm}), 0)::real`, longest: sql<number>`coalesce(max(${deliveries.loadedKm}), 0)::real` })
    .from(deliveries)
    .where(and(sql`${deliveries.vehicleId} in (${ids})`, eq(deliveries.status, 'completed')))
    .groupBy(deliveries.vehicleId);
  const fav = await db.execute<{ vehicle_id: string; name: string }>(sql`
    select distinct on (d.vehicle_id) d.vehicle_id, c.name_bg as name
    from ${deliveries} d join ${contracts} k on k.id = d.contract_id join ${cities} c on c.id = k.dest_city_id
    where d.vehicle_id in (${ids}) and d.status = 'completed'
    group by d.vehicle_id, c.name_bg order by d.vehicle_id, count(*) desc`);
  const favMap = new Map(fav.rows.map((r) => [r.vehicle_id, r.name]));
  return new Map(rows.map((r) => [r.vehicleId, { trips: r.trips, km: Math.round(r.km), longestKm: Math.round(r.longest), favouriteCity: favMap.get(r.vehicleId) ?? null }]));
}

/** Everything the garage page draws, for the owner or a visitor. */
export async function garageView(db: DbOrTx, ownerId: string, viewerId: string, now = new Date()) {
  const [owner] = await db.select({ id: users.id, username: users.username, level: users.level }).from(users).where(eq(users.id, ownerId));
  if (!owner) return null;
  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, ownerId));
  if (!company) return null;
  const { vehicles: fleet } = await fleetView(db, company.id);
  const trucks = fleet.filter((v) => v.ownership !== 'company');
  const history = await truckHistory(db, trucks.map((v) => v.id));
  const retired = await db
    .select({ id: vehicles.id, modelId: vehicles.modelId, color: vehicles.color, plate: vehicles.plate, nickname: vehicles.nickname, odometerKm: vehicles.odometerKm, soldAt: vehicles.soldAt })
    .from(vehicles)
    .where(and(eq(vehicles.companyId, company.id), isNotNull(vehicles.soldAt), eq(vehicles.ownership, 'owned')))
    .orderBy(desc(vehicles.soldAt))
    .limit(GARAGE.retroShelf);
  const likes = await db.select({ key: jobState.key, value: jobState.value, at: jobState.updatedAt }).from(jobState).where(like(jobState.key, `garage-like:${ownerId}:%`)).orderBy(desc(jobState.updatedAt));
  const visitorIds = likes.map((l) => l.key.split(':')[2]!).slice(0, 6);
  const names = visitorIds.length ? await db.select({ id: users.id, username: users.username }).from(users).where(sql`${users.id} in (${sql.join(visitorIds.map((id) => sql`${id}::uuid`), sql`, `)})`) : [];
  const nameOf = new Map(names.map((n) => [n.id, n.username]));
  const notes = likes
    .slice(0, 6)
    .map((l) => ({ username: nameOf.get(l.key.split(':')[2]!) ?? '', note: (l.value as { note?: string }).note ?? '', at: l.at.toISOString() }))
    .filter((n) => n.username);
  const [{ badges = 0 } = {}] = await db.select({ badges: sql<number>`count(*)::int` }).from(userBadges).where(eq(userBadges.userId, ownerId));
  const charms = await db.select({ itemId: inventoryItems.itemId }).from(inventoryItems).where(and(eq(inventoryItems.userId, ownerId), sql`${inventoryItems.qty} > 0`, sql`${inventoryItems.itemId} in ('truck_keychain','road_atlas','cb_mic','old_tachograph','trucker_cap','sunglasses')`));
  const hall = hallTier(owner.level);
  return {
    owner: { id: owner.id, username: owner.username, level: owner.level },
    mine: ownerId === viewerId,
    hall,
    night: hallIsNight(now),
    badges,
    charms: charms.map((c) => c.itemId),
    likes: likes.length,
    liked: likes.some((l) => l.key === likeKey(ownerId, viewerId)),
    notes,
    trucks: trucks.map((v) => ({
      id: v.id,
      plate: v.plate,
      nickname: v.nickname,
      modelId: v.modelId,
      brand: v.model.brand,
      name: v.model.name,
      kind: v.model.kind,
      color: v.color,
      cosmetics: (v.cosmetics ?? {}) as Cosmetics,
      condition: Math.round(v.condition),
      odometerKm: Math.round(v.odometerKm),
      upgrades: v.upgrades,
      status: v.status,
      ownership: v.ownership,
      city: v.city?.nameBg ?? v.city?.name ?? '',
      trailerModelId: v.trailer?.modelId ?? null,
      trailerColor: (v.trailer?.cosmetics as { paint?: string } | undefined)?.paint ?? null,
      stats: truckStats(v.upgrades, UPGRADES),
      history: history.get(v.id) ?? { trips: 0, km: 0, longestKm: 0, favouriteCity: null },
      // Before discounts (VIP and the company's service make it cheaper).
      repairCents: repairPlan({ priceCents: v.model.priceCents, condition: v.condition }, v.trailer ? { priceCents: trailerModel(v.trailer.modelId).priceCents, condition: v.trailer.condition } : null, 'all', 100, 1).costCents,
      service: { ...maintenanceState(v.odometerKm, v.serviceKm), cents: maintenanceCostCents(v.model.priceCents) },
    })),
    retired: retired.map((r) => ({ id: r.id, modelId: r.modelId, color: r.color, plate: r.plate, nickname: r.nickname, odometerKm: Math.round(r.odometerKm) })),
  };
}

export type GarageView = NonNullable<Awaited<ReturnType<typeof garageView>>>;
