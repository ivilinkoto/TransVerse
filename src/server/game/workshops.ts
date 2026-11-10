/**
 * 1.3 „Собствен сервиз“ on the server. A workshop lives in job_state under
 * `workshop:<owner>` (a WorkshopState); a customer's last repair there under
 * `workshop-visit:<owner>:<customer>` = { at, rated } (it allows one rating).
 */
import { and, eq, like } from 'drizzle-orm';
import { cleanWorkshopName, ownerShare, rating, WORKSHOP, type WorkshopState } from '@/lib/game/workshops';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companies, jobState, users, vehicles } from '@/server/db/schema';
import { fail } from './errors';
import { post } from './finance';
import { notify } from './notify';
import { t } from '@/i18n/t';

const key = (ownerId: string) => `workshop:${ownerId}`;
const visitKey = (ownerId: string, customerId: string) => `workshop-visit:${ownerId}:${customerId}`;

export async function getWorkshop(db: DbOrTx, ownerId: string): Promise<WorkshopState | null> {
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, key(ownerId)));
  return (row?.value as WorkshopState | undefined) ?? null;
}

async function account(db: DbOrTx, userId: string) {
  const [a] = await db.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
  if (!a) fail('company_not_found', t('Компанията не е намерена.'), 404);
  return a!;
}

/** Opens the player's workshop in a city (once). */
export async function openWorkshop(db: Database, userId: string, cityId: number, rawName: string, now: Date) {
  const name = cleanWorkshopName(rawName);
  if (!name) fail('bad_name', t('Името трябва да е от 3 до {0} знака.', WORKSHOP.nameMax));
  return db.transaction(async (tx) => {
    const [u] = await tx.select({ level: users.level }).from(users).where(eq(users.id, userId));
    if ((u?.level ?? 0) < WORKSHOP.minLevel) fail('level', t('Сервиз се отваря от ниво {0}.', WORKSHOP.minLevel));
    const [city] = await tx.select({ id: cities.id, name: cities.nameBg, country: cities.countryCode }).from(cities).where(eq(cities.id, cityId));
    if (!city) fail('city_not_found', t('Градът не е намерен.'), 404);
    const st: WorkshopState = { ownerId: userId, name: name!, cityId, city: city!.name, country: city!.country, pricePct: WORKSHOP.price.start, level: 1, repairs: 0, earnedCents: 0, ratingSum: 0, ratingCount: 0, openedAt: now.toISOString() };
    const [made] = await tx.insert(jobState).values({ key: key(userId), value: st, updatedAt: now }).onConflictDoNothing().returning({ key: jobState.key });
    if (!made) fail('has_workshop', t('Вече имаш сервиз.'));
    const acc = await account(tx, userId);
    await post(tx, acc.id, [{ category: 'depots', amountCents: -WORKSHOP.openCents, description: t('Сервиз „{0}“ в {1}', name!, city!.name), idempotencyKey: `workshop-open:${userId}` }], { requireFunds: true });
    return st;
  });
}

export async function setWorkshopPrice(db: DbOrTx, userId: string, pricePct: number, now: Date) {
  const w = await getWorkshop(db, userId);
  if (!w) fail('no_workshop', t('Още нямаш сервиз.'));
  const p = Math.round(pricePct);
  if (p < WORKSHOP.price.min || p > WORKSHOP.price.max) fail('bad_price', t('Цената е от {0}% до {1}% от обичайната.', WORKSHOP.price.min, WORKSHOP.price.max));
  await db.update(jobState).set({ value: { ...w!, pricePct: p }, updatedAt: now }).where(eq(jobState.key, key(userId)));
  return p;
}

export async function upgradeWorkshop(db: Database, userId: string, now: Date) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, key(userId))).for('update');
    const w = row?.value as WorkshopState | undefined;
    if (!w) fail('no_workshop', t('Още нямаш сервиз.'));
    const step = WORKSHOP.levels[w!.level - 1];
    if (!step || w!.level >= WORKSHOP.levels.length) fail('max_level', t('Сервизът е на най-високото ниво.'));
    const acc = await account(tx, userId);
    await post(tx, acc.id, [{ category: 'depots', amountCents: -step!.upgradeCents, description: t('Сервиз „{0}“: ниво {1}', w!.name, w!.level + 1), idempotencyKey: `workshop-upgrade:${userId}:${w!.level + 1}` }], { requireFunds: true });
    await tx.update(jobState).set({ value: { ...w!, level: w!.level + 1 }, updatedAt: now }).where(eq(jobState.key, key(userId)));
    return w!.level + 1;
  });
}

/** All workshops (few: one per player, from level 10). */
export async function allWorkshops(db: DbOrTx): Promise<WorkshopState[]> {
  const rows = await db.select({ value: jobState.value }).from(jobState).where(like(jobState.key, 'workshop:%'));
  return rows.map((r) => r.value as WorkshopState);
}

/** For the repair: checks the workshop can repair this truck and returns its price share. */
export async function workshopForRepair(tx: Tx, ownerId: string, customerId: string, vehicleCityId: number) {
  if (ownerId === customerId) fail('own_workshop', t('В собствения си сервиз не можеш да ремонтираш — там работиш за другите.'));
  const [row] = await tx.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, key(ownerId))).for('update');
  const w = row?.value as WorkshopState | undefined;
  if (!w) fail('no_workshop', t('Сервизът вече не работи.'), 404);
  if (w!.cityId !== vehicleCityId) fail('wrong_city', t('Камионът трябва да е в {0}, за да се ремонтира в този сервиз.', w!.city));
  return w!;
}

/** After a paid repair at a workshop: the owner's share, the stats, the visit (for a rating). */
export async function payWorkshop(tx: Tx, w: WorkshopState, customerId: string, paidCents: number, repairKey: string, plate: string, now: Date) {
  const cut = Math.round(paidCents * ownerShare(w.level));
  const acc = await account(tx, w.ownerId);
  const applied = await post(tx, acc.id, [{ category: 'bonus', amountCents: cut, description: t('Ремонт в сервиз „{0}“ ({1})', w.name, plate), idempotencyKey: `${repairKey}:workshop` }]);
  if (!applied) return 0;
  await tx.update(jobState).set({ value: { ...w, repairs: w.repairs + 1, earnedCents: w.earnedCents + cut }, updatedAt: now }).where(eq(jobState.key, key(w.ownerId)));
  const value = { at: now.toISOString(), rated: false };
  await tx.insert(jobState).values({ key: visitKey(w.ownerId, customerId), value, updatedAt: now }).onConflictDoUpdate({ target: jobState.key, set: { value, updatedAt: now } });
  await notify(tx, w.ownerId, 'success', () => t('Клиент в сервиза: {0}', plate), () => t('+{0} лв. от ремонт в „{1}“.', Math.round(cut / 100), w.name), '/game/workshops');
  return cut;
}

/** A customer rates the workshop once after a repair there. */
export async function rateWorkshop(db: Database, userId: string, ownerId: string, stars: number, now: Date) {
  if (stars < 1 || stars > 5) fail('bad_stars', t('Оценката е от 1 до 5 звезди.'));
  return db.transaction(async (tx) => {
    const [visit] = await tx.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, visitKey(ownerId, userId))).for('update');
    const v = visit?.value as { rated: boolean } | undefined;
    if (!v) fail('no_visit', t('Оценка се дава след ремонт в сервиза.'));
    if (v!.rated) fail('rated', t('Вече оцени този ремонт.'));
    const [row] = await tx.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, key(ownerId))).for('update');
    const w = row?.value as WorkshopState | undefined;
    if (!w) fail('no_workshop', t('Сервизът вече не работи.'), 404);
    await tx.update(jobState).set({ value: { ...w!, ratingSum: w!.ratingSum + stars, ratingCount: w!.ratingCount + 1 }, updatedAt: now }).where(eq(jobState.key, key(ownerId)));
    await tx.update(jobState).set({ value: { ...v!, rated: true }, updatedAt: now }).where(eq(jobState.key, visitKey(ownerId, userId)));
  });
}

/** The page: my workshop, and for each idle own truck the workshops in its city. */
export async function workshopsView(db: DbOrTx, userId: string) {
  const mine = await getWorkshop(db, userId);
  const all = await allWorkshops(db);
  const acc = await account(db, userId);
  const trucks = await db
    .select({ id: vehicles.id, plate: vehicles.plate, condition: vehicles.condition, cityId: vehicles.cityId, city: cities.nameBg, status: vehicles.status, ownership: vehicles.ownership })
    .from(vehicles)
    .innerJoin(cities, eq(cities.id, vehicles.cityId))
    .where(and(eq(vehicles.companyId, acc.id), eq(vehicles.status, 'idle')));
  const owners = new Map((await db.select({ id: users.id, username: users.username }).from(users)).filter((u) => all.some((w) => w.ownerId === u.id)).map((u) => [u.id, u.username]));
  const visits = await db.select({ key: jobState.key, value: jobState.value }).from(jobState).where(like(jobState.key, `workshop-visit:%:${userId}`));
  const toRate = visits.filter((v) => !(v.value as { rated: boolean }).rated).map((v) => v.key.split(':')[1]!);
  return {
    mine,
    trucks: trucks.filter((v) => v.ownership !== 'rented' && v.condition < 100).map((v) => ({ ...v, workshops: all.filter((w) => w.cityId === v.cityId && w.ownerId !== userId).map((w) => ({ ...w, owner: owners.get(w.ownerId) ?? '—', stars: rating(w) })) })),
    toRate: all.filter((w) => toRate.includes(w.ownerId)).map((w) => ({ ownerId: w.ownerId, name: w.name, city: w.city })),
    top: [...all].sort((a, b) => b.repairs - a.repairs).slice(0, 8).map((w) => ({ ...w, owner: owners.get(w.ownerId) ?? '—', stars: rating(w) })),
  };
}
