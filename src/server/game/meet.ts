/**
 * 1.2.7 „Заедно на пътя“: places and reasons to meet — the café of the city,
 * „Търся / Давам“ for items, market rumours and the duo of the week.
 */
import { and, desc, eq, gt, gte, isNull, ne, or, sql } from 'drizzle-orm';
import { CARGO, CARGO_TYPES, type CargoType } from '@/lib/game/cargo';
import { featureLive } from '@/lib/game/features';
import { sofiaHour } from '@/lib/game/halloween';
import { ITEMS, type ItemId } from '@/lib/game/items';
import { weekKey } from '@/lib/game/leagues';
import { DUO, ITEM_WANTS, RUMORS } from '@/lib/game/on-the-road';
import { LAUNCH_COUNTRIES } from '@/lib/geo/scope';
import { sofiaDay } from '@/lib/game/shop-v2';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companies, duoSignups, duos, inventoryItems, itemWants, jobState, marketRumors, users, vehicles } from '@/server/db/schema';
import { postGameLine } from './chat-life';
import { fail } from './errors';
import { post } from './finance';
import { rewardCase } from './inventory';
import { membershipOf } from './membership';
import { sendDirectMessage } from './messages';
import { notify } from './notify';
import { addPassPoints } from './season-pass';
import { t, tx as place } from '@/i18n/t';

const nameOf = async (db: DbOrTx, userId: string) => (await db.select({ username: users.username }).from(users).where(eq(users.id, userId)))[0]?.username ?? '';

// ── The café of the city ─────────────────────────────────────────────────

/** The café a player sits in: the city of a truck standing there (else the base). */
export async function cafeCity(db: DbOrTx, userId: string) {
  const [co] = await db.select({ id: companies.id, hq: companies.hqCityId }).from(companies).where(eq(companies.ownerId, userId));
  if (!co) return null;
  const [truck] = await db.select({ cityId: vehicles.cityId }).from(vehicles).where(and(eq(vehicles.companyId, co.id), eq(vehicles.status, 'idle'))).limit(1);
  const id = truck?.cityId ?? co.hq;
  const [c] = await db.select({ id: cities.id, nameBg: cities.nameBg }).from(cities).where(eq(cities.id, id));
  return c ?? null;
}

/** Who is in the café: players with a truck standing in the city (up to 12, the latest seen first). */
export async function cafeHere(db: DbOrTx, cityId: number) {
  return db
    .selectDistinct({ id: users.id, username: users.username, lastSeenAt: users.lastSeenAt })
    .from(vehicles)
    .innerJoin(companies, eq(companies.id, vehicles.companyId))
    .innerJoin(users, eq(users.id, companies.ownerId))
    .where(and(eq(vehicles.cityId, cityId), eq(vehicles.status, 'idle'), isNull(users.bannedAt)))
    .orderBy(desc(users.lastSeenAt))
    .limit(12);
}

// ── „Търся / Давам“ ──────────────────────────────────────────────────────

/** „Търся“: a player marks an item they want (up to 5); the ones with a spare are told once. */
export async function wantItem(db: Database, userId: string, itemId: string, want: boolean, now = new Date()) {
  if (!(itemId in ITEMS)) fail('unknown_item', t('Няма такъв предмет.'), 404);
  if (!want) {
    await db.delete(itemWants).where(and(eq(itemWants.userId, userId), eq(itemWants.itemId, itemId)));
    return { ok: true, wants: false };
  }
  const [{ n = 0 } = {}] = await db.select({ n: sql<number>`count(*)::int` }).from(itemWants).where(eq(itemWants.userId, userId));
  if (n >= ITEM_WANTS.max) fail('too_many_wants', t('Можеш да търсиш най-много {0} предмета наведнъж.', ITEM_WANTS.max));
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(itemWants).values({ userId, itemId }).onConflictDoNothing().returning();
    if (!row) return { ok: true, wants: true };
    const me = await nameOf(tx, userId);
    const name = ITEMS[itemId as ItemId].name;
    for (const o of await spareOwners(tx, userId, itemId, 5)) {
      const [first] = await tx.insert(jobState).values({ key: `want-told:${o.id}:${userId}:${itemId}`, value: { at: now.toISOString() } }).onConflictDoNothing().returning();
      if (first) await notify(tx, o.id, 'info', () => t('🔎 {0} търси „{1}“', me, t(name)), () => t('Имаш резервен. Пиши му — може да се разберете за размяна.'), `/game?chat=dm:${userId}`);
    }
    return { ok: true, wants: true };
  });
}

/** Players who have a spare of an item (2 or more), the latest seen first. */
export async function spareOwners(db: DbOrTx, userId: string, itemId: string, limit = 8) {
  return db
    .select({ id: users.id, username: users.username, qty: inventoryItems.qty })
    .from(inventoryItems)
    .innerJoin(users, eq(users.id, inventoryItems.userId))
    .where(and(eq(inventoryItems.itemId, itemId), gte(inventoryItems.qty, 2), ne(inventoryItems.userId, userId), isNull(users.bannedAt)))
    .orderBy(desc(users.lastSeenAt))
    .limit(limit);
}

/** The player's wants with who has a spare, and what others want that the player can give. */
export async function wantsView(db: DbOrTx, userId: string) {
  const mine = await db.select({ itemId: itemWants.itemId }).from(itemWants).where(eq(itemWants.userId, userId));
  const wants = [];
  for (const w of mine) wants.push({ itemId: w.itemId, name: ITEMS[w.itemId as ItemId]?.name ?? w.itemId, owners: (await spareOwners(db, userId, w.itemId, 5)).map((o) => ({ id: o.id, username: o.username })) });
  const canGive = await db
    .select({ userId: itemWants.userId, username: users.username, itemId: itemWants.itemId })
    .from(itemWants)
    .innerJoin(users, eq(users.id, itemWants.userId))
    .innerJoin(inventoryItems, and(eq(inventoryItems.itemId, itemWants.itemId), eq(inventoryItems.userId, userId), gte(inventoryItems.qty, 2)))
    .where(ne(itemWants.userId, userId))
    .orderBy(desc(itemWants.createdAt))
    .limit(10);
  return { wants, canGive: canGive.map((g) => ({ ...g, name: ITEMS[g.itemId as ItemId]?.name ?? g.itemId })) };
}

// ── Market rumours ───────────────────────────────────────────────────────

const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)]!;
const rumorText = (r: { country: string; cargo: string }, countryName: string) => t('🗣️ Слух: утре {0} до {1} ще се плащат с {2} % повече. Вярно ли е? Питай в чата.', t(CARGO[r.cargo as CargoType].label).toLowerCase(), place(countryName), Math.round(RUMORS.bonusShare * 100));

/**
 * Worker: in the evening the rumours about tomorrow are made — three, only one of them true —
 * and each one is whispered to a part of the active players. Tomorrow a delivery of the true
 * one's cargo to its country, on time, pays more; in the morning the game says which it was.
 */
export async function spreadRumors(db: Database, now = new Date(), rand: () => number = Math.random) {
  if (!featureLive('rumors', now) || sofiaHour(now) < RUMORS.hour) return 0;
  const tomorrow = sofiaDay(new Date(now.getTime() + 86_400_000));
  return db.transaction(async (tx) => {
    const [first] = await tx.insert(jobState).values({ key: `rumors:${tomorrow}`, value: {} }).onConflictDoNothing().returning();
    if (!first) return 0;
    const made: { country: string; cargo: string; real: boolean }[] = [];
    const used = new Set<string>();
    for (let i = 0; made.length < RUMORS.perDay && i < 30; i++) {
      const r = { country: pick(LAUNCH_COUNTRIES), cargo: pick(CARGO_TYPES.filter((c) => c !== 'livestock' && c !== 'vehicles')), real: made.length === 0 };
      if (used.has(`${r.country}:${r.cargo}`)) continue;
      used.add(`${r.country}:${r.cargo}`);
      made.push(r);
    }
    const rows = await tx.insert(marketRumors).values(made.map((r) => ({ ...r, day: tomorrow }))).returning();
    const active = await tx.select({ id: users.id }).from(users).where(and(gt(users.lastSeenAt, new Date(now.getTime() - 3 * 86_400_000)), isNull(users.bannedAt)));
    let told = 0;
    for (const u of active) {
      if (rand() >= RUMORS.share) continue;
      const r = rows[Math.floor(rand() * rows.length)]!;
      await notify(tx, u.id, 'info', () => t('🗣️ Чу се нещо…'), () => rumorText(r, countryLabel(r.country)), '/game?chat=global');
      told++;
    }
    return told;
  });
}

const COUNTRY_LABEL: Record<string, string> = { BG: 'България', RO: 'Румъния', GR: 'Гърция', TR: 'Турция', RS: 'Сърбия', MK: 'Северна Македония', HU: 'Унгария', AT: 'Австрия', DE: 'Германия' };
const countryLabel = (code: string) => COUNTRY_LABEL[code] ?? code;

/** Worker: in the morning the game tells the chat which rumour was true (once a day). */
export async function confirmRumor(db: Database, now = new Date()) {
  if (!featureLive('rumors', now) || sofiaHour(now) < 8) return null;
  const day = sofiaDay(now);
  const [real] = await db.select().from(marketRumors).where(and(eq(marketRumors.day, day), eq(marketRumors.real, true)));
  if (!real) return null;
  return db.transaction(async (tx) => {
    const [first] = await tx.insert(jobState).values({ key: `rumor-told:${day}`, value: {} }).onConflictDoNothing().returning();
    if (!first) return null;
    return postGameLine(tx, 'global', 'rumor', t('🗣️ Слухът се потвърди: днес {0} до {1} се плащат с {2} % повече (навреме). Другите слухове бяха празни приказки.', t(CARGO[real.cargo as CargoType].label).toLowerCase(), place(countryLabel(real.country)), Math.round(RUMORS.bonusShare * 100)), { href: '/game/contracts', button: t('Курсове') }, now);
  });
}

/** settleDelivery: the true rumour's cargo to its country, on time, on its day — a bonus. */
async function rumorBonus(tx: Tx, companyId: string, trip: { id: string }, load: { cargoType: string; rewardCents: number }, destCountry: string, late: boolean, at: Date) {
  if (late || !featureLive('rumors', at)) return 0;
  const [real] = await tx.select({ id: marketRumors.id }).from(marketRumors).where(and(eq(marketRumors.day, sofiaDay(at)), eq(marketRumors.real, true), eq(marketRumors.country, destCountry), eq(marketRumors.cargo, load.cargoType)));
  if (!real) return 0;
  const cents = Math.round(load.rewardCents * RUMORS.bonusShare);
  await post(tx, companyId, [{ category: 'bonus', amountCents: cents, description: t('Слухът се потвърди'), idempotencyKey: `rumor:${trip.id}`, refType: 'delivery', refId: trip.id }]);
  return cents;
}

// ── The duo of the week ──────────────────────────────────────────────────

/** A player signs up for this week's duo (pairs are made on Monday at noon). */
export async function signUpDuo(db: Database, userId: string, now = new Date()) {
  const week = weekKey(now);
  const [paired] = await db.select({ id: duos.id }).from(duos).where(and(eq(duos.week, week), or(eq(duos.aId, userId), eq(duos.bId, userId))));
  if (paired) fail('already_paired', t('Тази седмица вече имаш двойка.'));
  await db.insert(duoSignups).values({ week, userId }).onConflictDoNothing();
  return { ok: true };
}

/** Worker: from Monday noon the sign-ups are paired, two different companies a pair; late sign-ups the same day. */
export async function pairDuos(db: Database, now = new Date(), rand: () => number = Math.random) {
  if (!featureLive('duo_week', now)) return 0;
  const week = weekKey(now);
  if (sofiaDay(now) === week.slice(1) && sofiaHour(now) < DUO.pairHour) return 0;
  const waiting = await db
    .select({ userId: duoSignups.userId })
    .from(duoSignups)
    .where(and(eq(duoSignups.week, week), sql`not exists (select 1 from ${duos} d where d.week = ${week} and (d.a_id = ${duoSignups.userId} or d.b_id = ${duoSignups.userId}))`));
  const list = waiting.map((w) => w.userId).sort(() => rand() - 0.5);
  const orgOf = new Map<string, string | null>();
  for (const u of list) orgOf.set(u, (await membershipOf(db, u))?.company.id ?? null);
  let made = 0;
  while (list.length >= 2) {
    const a = list.shift()!;
    const i = list.findIndex((b) => !orgOf.get(a) || orgOf.get(a) !== orgOf.get(b));
    if (i < 0) continue;
    const [b] = list.splice(i, 1);
    await db.transaction(async (tx) => {
      const [row] = await tx.insert(duos).values({ week, aId: a, bId: b!, target: DUO.target }).onConflictDoNothing().returning({ id: duos.id });
      if (!row) return;
      const [na, nb] = [await nameOf(tx, a), await nameOf(tx, b!)];
      await notify(tx, a, 'success', () => t('🤝 Двойката ти за седмицата: {0}', nb), () => t('{0} доставки заедно до неделя — точки и кейс за двамата. Пиши му!', DUO.target), `/game?chat=dm:${b}`);
      await notify(tx, b!, 'success', () => t('🤝 Двойката ти за седмицата: {0}', na), () => t('{0} доставки заедно до неделя — точки и кейс за двамата. Пиши му!', DUO.target), `/game?chat=dm:${a}`);
      made++;
    });
    try {
      await sendDirectMessage(db, a, b!, t('🤝 Играта ни събра за „Двойка на седмицата“: {0} доставки заедно до неделя. Успех!', DUO.target), now);
    } catch {
      /* blocked or muted: the notifications are enough */
    }
  }
  return made;
}

/** settleDelivery: a delivery of either one moves the duo's goal; at the goal — points and a case for both. */
async function duoProgress(tx: Tx, userId: string, at: Date) {
  if (!featureLive('duo_week', at)) return;
  const [d] = await tx.select().from(duos).where(and(eq(duos.week, weekKey(at)), or(eq(duos.aId, userId), eq(duos.bId, userId)), isNull(duos.doneAt))).for('update');
  if (!d) return;
  const progress = d.progress + 1;
  const done = progress >= d.target;
  await tx.update(duos).set({ progress, doneAt: done ? at : null }).where(eq(duos.id, d.id));
  if (!done) return;
  for (const u of [d.aId, d.bId]) {
    await addPassPoints(tx, u, DUO.passPoints, at);
    await rewardCase(tx, u, DUO.case, 'duo_week', `duo-case:${d.id}:${u}`, at);
    await notify(tx, u, 'achievement', () => t('🤝 Двойката на седмицата изпълни целта!'), () => t('+{0} точки за пропуска и сребърен кейс.', DUO.passPoints), '/game/seasons');
  }
}

/** The player's duo of the week (for the card on the pass page). */
export async function duoView(db: DbOrTx, userId: string, now = new Date()) {
  const week = weekKey(now);
  const [d] = await db.select().from(duos).where(and(eq(duos.week, week), or(eq(duos.aId, userId), eq(duos.bId, userId))));
  if (d) {
    const other = d.aId === userId ? d.bId : d.aId;
    return { state: 'paired' as const, partnerId: other, partner: await nameOf(db, other), progress: d.progress, target: d.target, done: !!d.doneAt };
  }
  const [s] = await db.select({ userId: duoSignups.userId }).from(duoSignups).where(and(eq(duoSignups.week, week), eq(duoSignups.userId, userId)));
  return { state: s ? ('waiting' as const) : ('open' as const), target: DUO.target };
}

/** settleDelivery: what 1.2.7 adds on arrival besides the escort. Returns the bonus paid. */
export async function meetDelivered(tx: Tx, userId: string, companyId: string, trip: { id: string }, load: { cargoType: string; rewardCents: number }, destCountry: string, late: boolean, at: Date) {
  const bonus = await rumorBonus(tx, companyId, trip, load, destCountry, late, at);
  await duoProgress(tx, userId, at);
  return bonus;
}

