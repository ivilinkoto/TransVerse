/**
 * 1.2.3.6 „Рампата“: unloading slots at the big warehouses, the queue when the
 * docks are full, swapping a slot for a gift, and „Най-точен на рампата“.
 */
import { and, desc, eq, gt, gte, inArray, lt, ne, or, sql } from 'drizzle-orm';
import { DOCK, bookSlot, dockSegment, hasDock, slotOf, waitFor, withDockWait } from '@/lib/game/dock';
import { weekEndsAt, weekKey } from '@/lib/game/leagues';
import type { Segment } from '@/lib/game/schedule';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, deliveries, dockSlots, dockSwaps, users } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { companyForUser } from './company';
import { fail } from './errors';
import { post, type Posting } from './finance';
import { broadcast, notify } from './notify';
import { t as tr } from '@/i18n/t';
import { money } from '@/lib/format';

export type DockBooking = { cityId: number; slotAt: Date; arriveAt: Date; waitMin: number };

/**
 * When a load goes to a big warehouse: the slot of the arrival, or the first free one after it.
 * Returns the schedule with the queue in it and the booking to save with the delivery.
 */
export async function planDock(tx: Tx, userId: string, destCityId: number, schedule: Segment[], now: Date): Promise<{ schedule: Segment[]; booking: DockBooking } | null> {
  if (!(await featureFor(tx, userId, 'dock_slots', now))) return null;
  const [city] = await tx.select({ population: cities.population }).from(cities).where(eq(cities.id, destCityId));
  if (!city || !hasDock(city.population)) return null;
  const i = dockSegment(schedule);
  if (i < 0) return null;
  const arriveAt = schedule[i]!.start;
  // One booking at a time per warehouse, so a slot is never given to more trucks than it has docks.
  await tx.execute(sql`select pg_advisory_xact_lock(${73_100_000 + destCityId})`);
  const from = slotOf(arriveAt);
  const rows = await tx
    .select({ slotAt: dockSlots.slotAt, n: sql<number>`count(*)::int` })
    .from(dockSlots)
    .where(and(eq(dockSlots.cityId, destCityId), gte(dockSlots.slotAt, new Date(from)), lt(dockSlots.slotAt, new Date(from + (DOCK.maxQueueSlots + 1) * DOCK.slotMin * 60_000))))
    .groupBy(dockSlots.slotAt);
  const { slotAt, waitMs } = bookSlot(arriveAt, new Map(rows.map((r) => [r.slotAt.getTime(), r.n])));
  return { schedule: waitMs ? withDockWait(schedule, waitMs) : schedule, booking: { cityId: destCityId, slotAt: new Date(slotAt), arriveAt: new Date(arriveAt), waitMin: Math.round(waitMs / 60_000) } };
}

export async function saveDock(tx: Tx, deliveryId: string, userId: string, b: DockBooking) {
  await tx.insert(dockSlots).values({ deliveryId, userId, cityId: b.cityId, slotAt: b.slotAt, arriveAt: b.arriveAt, waitMin: b.waitMin }).onConflictDoNothing();
}

const weekStart = (now: Date) => new Date(weekEndsAt(weekKey(now)).getTime() - 7 * 86_400_000);

/** „Най-точен на рампата“: trucks that went straight to the dock and were on time this week. */
export async function dockBoard(db: DbOrTx, now = new Date(), limit: number = DOCK.board) {
  return db
    .select({ userId: dockSlots.userId, username: users.username, count: sql<number>`count(*)::int` })
    .from(dockSlots)
    .innerJoin(deliveries, eq(deliveries.id, dockSlots.deliveryId))
    .innerJoin(users, eq(users.id, dockSlots.userId))
    .where(and(eq(dockSlots.waitMin, 0), eq(deliveries.status, 'completed'), eq(deliveries.late, false), gte(deliveries.completedAt, weekStart(now))))
    .groupBy(dockSlots.userId, users.username)
    .orderBy(desc(sql`count(*)`), users.username)
    .limit(limit);
}

/** The player's bookings on the way, the trucks they could swap with, the offers and the board. */
export async function dockView(db: DbOrTx, userId: string, now = new Date()) {
  const mine = await db
    .select({ deliveryId: dockSlots.deliveryId, cityId: dockSlots.cityId, city: cities.nameBg, slotAt: dockSlots.slotAt, arriveAt: dockSlots.arriveAt, waitMin: dockSlots.waitMin, etaAt: deliveries.etaAt })
    .from(dockSlots)
    .innerJoin(deliveries, eq(deliveries.id, dockSlots.deliveryId))
    .innerJoin(cities, eq(cities.id, dockSlots.cityId))
    .where(and(eq(dockSlots.userId, userId), eq(deliveries.status, 'in_progress')))
    .orderBy(dockSlots.arriveAt);
  // Earlier slots at the same warehouses held by trucks that are not at the dock yet.
  const queued = mine.filter((m) => m.waitMin > 0 && m.arriveAt > now);
  const others = queued.length
    ? await db
        .select({ deliveryId: dockSlots.deliveryId, cityId: dockSlots.cityId, slotAt: dockSlots.slotAt, arriveAt: dockSlots.arriveAt, username: users.username })
        .from(dockSlots)
        .innerJoin(deliveries, eq(deliveries.id, dockSlots.deliveryId))
        .innerJoin(users, eq(users.id, dockSlots.userId))
        .where(and(inArray(dockSlots.cityId, [...new Set(queued.map((q) => q.cityId))]), ne(dockSlots.userId, userId), eq(deliveries.status, 'in_progress'), gt(dockSlots.arriveAt, now)))
    : [];
  const bookings = mine.map((m) => ({
    ...m,
    swaps: m.waitMin > 0 && m.arriveAt > now ? others.filter((o) => o.cityId === m.cityId && o.slotAt < m.slotAt).map((o) => ({ deliveryId: o.deliveryId, username: o.username, slotAt: o.slotAt, gain: Math.round((m.slotAt.getTime() - Math.max(o.slotAt.getTime(), slotOf(m.arriveAt.getTime()))) / 60_000) })) : [],
  }));
  const offers = await db
    .select({ id: dockSwaps.id, fromUserId: dockSwaps.fromUserId, toUserId: dockSwaps.toUserId, giftCents: dockSwaps.giftCents, status: dockSwaps.status, fromDeliveryId: dockSwaps.fromDeliveryId, toDeliveryId: dockSwaps.toDeliveryId, createdAt: dockSwaps.createdAt })
    .from(dockSwaps)
    .where(and(eq(dockSwaps.status, 'open'), or(eq(dockSwaps.toUserId, userId), eq(dockSwaps.fromUserId, userId))))
    .orderBy(desc(dockSwaps.createdAt));
  const ids = [...new Set(offers.flatMap((o) => [o.fromUserId, o.toUserId]))];
  const names = ids.length ? await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, ids)) : [];
  const slotIds = [...new Set(offers.flatMap((o) => [o.fromDeliveryId, o.toDeliveryId]))];
  const slots = slotIds.length ? await db.select({ deliveryId: dockSlots.deliveryId, slotAt: dockSlots.slotAt, city: cities.nameBg }).from(dockSlots).innerJoin(cities, eq(cities.id, dockSlots.cityId)).where(inArray(dockSlots.deliveryId, slotIds)) : [];
  const nameOf = (id: string) => names.find((n) => n.id === id)?.username ?? '';
  const slotOfDelivery = (id: string) => slots.find((s) => s.deliveryId === id);
  return {
    bookings,
    incoming: offers.filter((o) => o.toUserId === userId).map((o) => ({ id: o.id, from: nameOf(o.fromUserId), giftCents: o.giftCents, city: slotOfDelivery(o.toDeliveryId)?.city ?? '', yourSlot: slotOfDelivery(o.toDeliveryId)?.slotAt ?? null, theirSlot: slotOfDelivery(o.fromDeliveryId)?.slotAt ?? null })),
    outgoing: offers.filter((o) => o.fromUserId === userId).map((o) => ({ id: o.id, to: nameOf(o.toUserId), giftCents: o.giftCents, city: slotOfDelivery(o.toDeliveryId)?.city ?? '' })),
    board: await dockBoard(db, now),
  };
}

/** A player in the queue offers a gift for another truck's earlier slot at the same warehouse. */
export async function offerDockSwap(db: Database, userId: string, fromDeliveryId: string, toDeliveryId: string, giftCents: number, now = new Date()) {
  if (!Number.isInteger(giftCents) || giftCents < DOCK.giftMinCents || giftCents > DOCK.giftMaxCents) fail('invalid_gift', tr('Подаръкът е от {0} до {1}.', money(DOCK.giftMinCents), money(DOCK.giftMaxCents)));
  return db.transaction(async (tx) => {
    const rows = await tx.select({ s: dockSlots, status: deliveries.status }).from(dockSlots).innerJoin(deliveries, eq(deliveries.id, dockSlots.deliveryId)).where(inArray(dockSlots.deliveryId, [fromDeliveryId, toDeliveryId]));
    const mine = rows.find((r) => r.s.deliveryId === fromDeliveryId);
    const theirs = rows.find((r) => r.s.deliveryId === toDeliveryId);
    if (!mine || mine.s.userId !== userId || mine.status !== 'in_progress') fail('not_found', tr('Този час на рампата не е твой.'), 404);
    if (!theirs || theirs.status !== 'in_progress' || theirs.s.userId === userId) fail('not_found', tr('Няма такъв камион на рампата.'), 404);
    if (theirs!.s.cityId !== mine!.s.cityId || theirs!.s.slotAt >= mine!.s.slotAt) fail('no_gain', tr('Размяна има смисъл само за по-ранен час в същия склад.'));
    if (mine!.s.arriveAt <= now || theirs!.s.arriveAt <= now) fail('too_late', tr('Единият камион вече е на рампата.'));
    const company = await companyForUser(tx, userId);
    if (company.balanceCents < giftCents) fail('insufficient_funds', tr('Нямате достатъчно средства.'));
    await tx.insert(dockSwaps).values({ fromDeliveryId, toDeliveryId, fromUserId: userId, toUserId: theirs!.s.userId, giftCents, createdAt: now })
      .onConflictDoUpdate({ target: [dockSwaps.fromDeliveryId, dockSwaps.toDeliveryId], set: { giftCents, status: 'open', decidedAt: null, createdAt: now } });
    const [me] = await tx.select({ username: users.username }).from(users).where(eq(users.id, userId));
    const [city] = await tx.select({ name: cities.nameBg }).from(cities).where(eq(cities.id, mine!.s.cityId));
    await notify(tx, theirs!.s.userId, 'info', () => tr('🏭 {0} иска твоя час на рампата', me?.username ?? ''), () => tr('Склад {0}: размени часа си срещу подарък {1}. Камионът ти ще разтовари по-късно.', tr(city?.name ?? ''), money(giftCents)), '/game/dock');
    return { ok: true };
  });
}

/** The holder of the earlier slot answers: a swap moves both unloadings and pays the gift. */
export async function answerDockSwap(db: Database, userId: string, swapId: string, accept: boolean, now = new Date()) {
  return db.transaction(async (tx) => {
    const [swap] = await tx.select().from(dockSwaps).where(and(eq(dockSwaps.id, swapId), eq(dockSwaps.toUserId, userId), eq(dockSwaps.status, 'open'))).for('update');
    if (!swap) fail('not_found', tr('Предложението вече не е активно.'), 404);
    if (!accept) {
      await tx.update(dockSwaps).set({ status: 'declined', decidedAt: now }).where(eq(dockSwaps.id, swapId));
      await notify(tx, swap!.fromUserId, 'info', () => tr('🏭 Размяната на рампата е отказана'), () => tr('Камионът ти остава на опашката.'), '/game/dock');
      return { accepted: false };
    }
    const ds = await tx.select().from(deliveries).where(inArray(deliveries.id, [swap!.fromDeliveryId, swap!.toDeliveryId])).orderBy(deliveries.id).for('update');
    const slots = await tx.select().from(dockSlots).where(inArray(dockSlots.deliveryId, [swap!.fromDeliveryId, swap!.toDeliveryId])).for('update');
    const a = slots.find((s) => s.deliveryId === swap!.fromDeliveryId);
    const b = slots.find((s) => s.deliveryId === swap!.toDeliveryId);
    const da = ds.find((d) => d.id === swap!.fromDeliveryId);
    const db2 = ds.find((d) => d.id === swap!.toDeliveryId);
    const stale = () => tx.update(dockSwaps).set({ status: 'expired', decidedAt: now }).where(eq(dockSwaps.id, swapId));
    if (!a || !b || !da || !db2 || da.status !== 'in_progress' || db2.status !== 'in_progress' || a.arriveAt <= now || b.arriveAt <= now || b.slotAt >= a.slotAt) {
      await stale();
      fail('too_late', tr('Часовете вече не могат да се разменят.'));
    }
    // A (in the queue) takes B's earlier slot; B takes A's later one.
    const waitA = waitFor(a!.arriveAt.getTime(), b!.slotAt.getTime());
    const waitB = waitFor(b!.arriveAt.getTime(), a!.slotAt.getTime());
    const move = async (d: typeof da, s: typeof a, slotAt: Date, waitMs: number) => {
      const schedule = withDockWait(d!.schedule as Segment[], waitMs, s!.waitMin * 60_000);
      const eta = Math.max(...schedule.map((x) => x.end));
      await tx.update(deliveries).set({ schedule, etaAt: new Date(eta) }).where(eq(deliveries.id, d!.id));
      await tx.update(dockSlots).set({ slotAt, waitMin: Math.round(waitMs / 60_000) }).where(eq(dockSlots.deliveryId, d!.id));
    };
    await move(da, a, b!.slotAt, waitA);
    await move(db2, b, a!.slotAt, waitB);
    const [from, to] = await Promise.all([companyForUser(tx, swap!.fromUserId), companyForUser(tx, swap!.toUserId)]);
    const key = `dock-swap:${swap!.id}`;
    const [names] = await tx.select({ city: cities.nameBg }).from(cities).where(eq(cities.id, a!.cityId));
    // Fixed lock order by company id (both postings lock a company row).
    const out: Posting = { category: 'dock_swap', amountCents: -swap!.giftCents, description: tr('Размяна на час на рампата ({0})', names?.city ?? ''), idempotencyKey: `${key}:out`, refType: 'dock_swap', refId: swap!.id };
    const inn: Posting = { category: 'dock_swap', amountCents: swap!.giftCents, description: tr('Подарък за час на рампата ({0})', names?.city ?? ''), idempotencyKey: `${key}:in`, refType: 'dock_swap', refId: swap!.id };
    if (from.id < to.id) {
      await post(tx, from.id, [out], { requireFunds: true });
      await post(tx, to.id, [inn]);
    } else {
      await post(tx, to.id, [inn]);
      await post(tx, from.id, [out], { requireFunds: true });
    }
    await tx.update(dockSwaps).set({ status: 'accepted', decidedAt: now }).where(eq(dockSwaps.id, swapId));
    // Other open offers for these two trucks are no longer valid.
    await tx.update(dockSwaps).set({ status: 'expired', decidedAt: now }).where(and(eq(dockSwaps.status, 'open'), or(inArray(dockSwaps.fromDeliveryId, [a!.deliveryId, b!.deliveryId]), inArray(dockSwaps.toDeliveryId, [a!.deliveryId, b!.deliveryId]))));
    await notify(tx, swap!.fromUserId, 'info', () => tr('🏭 Размяната на рампата е приета'), () => tr('Камионът ти разтоварва по-рано в {0}.', tr(names?.city ?? '')), '/game/dock');
    await broadcast(tx, 'world');
    return { accepted: true, waitMin: Math.round(waitA / 60_000) };
  });
}
