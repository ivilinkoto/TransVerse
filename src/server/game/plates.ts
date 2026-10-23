import { and, eq, isNull, lte, sql } from 'drizzle-orm';
import { periodWindow } from '@/lib/game/missions';
import { nextMinBid, RARE_PLATES } from '@/lib/game/plates';
import type { Database, DbOrTx } from '@/server/db/client';
import { plateAuctions, users, vehicles } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { postCoins } from './coins';
import { companyForUser } from './company';
import { fail } from './errors';
import { notify } from './notify';

const plateInUse = async (db: DbOrTx, plate: string) => {
  const { rows } = await db.execute<{ taken: boolean }>(sql`select exists(select 1 from vehicles where upper(plate) = ${plate} and sold_at is null) or exists(select 1 from trailers where upper(plate) = ${plate} and sold_at is null) as taken`);
  return !!rows[0]?.taken;
};

/** Worker: this week's auction (the next rare plate that is free and not won yet). */
export async function ensurePlateAuction(db: Database, now = new Date()) {
  const week = periodWindow('weekly', now);
  const [existing] = await db.select({ weekKey: plateAuctions.weekKey }).from(plateAuctions).where(eq(plateAuctions.weekKey, week.key));
  if (existing) return null;
  const won = new Set((await db.select({ plate: plateAuctions.plate }).from(plateAuctions).where(isNull(plateAuctions.vehicleId))).map((r) => r.plate));
  const n = Number(week.key.slice(-2)) || 0;
  const order = [...RARE_PLATES.slice(n % RARE_PLATES.length), ...RARE_PLATES.slice(0, n % RARE_PLATES.length)];
  for (const plate of order) {
    if (won.has(plate) || (await plateInUse(db, plate))) continue;
    const [row] = await db.insert(plateAuctions).values({ weekKey: week.key, plate, endsAt: week.endsAt, createdAt: now }).onConflictDoNothing().returning();
    return row ?? null;
  }
  return null;
}

/** A bid in ТрансКоин: held at once; the bid it beats goes back to its bidder. */
export async function bidForPlate(db: Database, userId: string, coins: number, now = new Date()) {
  if (!(await featureFor(db, userId, 'plate_auction', now))) fail('not_released', 'Това идва със следващото обновление.', 403);
  return db.transaction(async (tx) => {
    const week = periodWindow('weekly', now);
    const [a] = await tx.select().from(plateAuctions).where(eq(plateAuctions.weekKey, week.key)).for('update');
    if (!a || a.endsAt <= now) fail('no_auction', 'Тази седмица няма търг за номер.', 404);
    if (a!.bidUserId === userId) fail('leading', 'Твоята оферта води.');
    const min = nextMinBid(a!.bidCoins);
    if (!Number.isSafeInteger(coins) || coins < min) fail('low', `Офертата е поне ${min} TC.`);
    // Fixed lock order: the bidder first, then the one outbid (both personal).
    await postCoins(tx, userId, { amount: -coins, reason: 'plate_auction', description: `Оферта за номер „${a!.plate}“`, idempotencyKey: `plate-bid:${a!.weekKey}:${a!.bids + 1}` }, { requireFunds: true });
    if (a!.bidUserId && a!.bidCoins) {
      await postCoins(tx, a!.bidUserId, { amount: a!.bidCoins, reason: 'plate_auction', description: `Върната оферта за номер „${a!.plate}“`, idempotencyKey: `plate-refund:${a!.weekKey}:${a!.bids}` });
      await notify(tx, a!.bidUserId, 'info', `Офертата ти за номер „${a!.plate}“ е надмината`, `Нова оферта: ${coins} TC. Твоите ${a!.bidCoins} TC са върнати.`, '/game/plates');
    }
    await tx.update(plateAuctions).set({ bidUserId: userId, bidCoins: coins, bids: a!.bids + 1 }).where(eq(plateAuctions.weekKey, a!.weekKey));
    return { plate: a!.plate, coins };
  });
}

/** Worker: ended auctions get their winner (the coins stay spent). */
export async function settlePlateAuctions(db: Database, now = new Date()) {
  const due = await db.select().from(plateAuctions).where(and(isNull(plateAuctions.settledAt), lte(plateAuctions.endsAt, now)));
  for (const a of due) {
    await db.transaction(async (tx) => {
      const [mine] = await tx.update(plateAuctions).set({ settledAt: now }).where(and(eq(plateAuctions.weekKey, a.weekKey), isNull(plateAuctions.settledAt))).returning();
      if (mine?.bidUserId) await notify(tx, mine.bidUserId, 'achievement', `Номерът „${mine.plate}“ е твой! 🏷️`, 'Сложи го на свой камион от страницата на търга.', '/game/plates');
    });
  }
  return due.length;
}

/** The winner fits the plate on an own truck (once). */
export async function fitRarePlate(db: Database, userId: string, weekKey: string, vehicleId: string) {
  return db.transaction(async (tx) => {
    const [a] = await tx.select().from(plateAuctions).where(eq(plateAuctions.weekKey, weekKey)).for('update');
    if (!a || !a.settledAt || a.bidUserId !== userId) fail('not_won', 'Този номер не е твой.', 403);
    if (a!.vehicleId) fail('fitted', 'Номерът вече е сложен.');
    const account = await companyForUser(tx, userId);
    const [v] = await tx.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.companyId, account.id), isNull(vehicles.soldAt))).for('update');
    if (!v) fail('vehicle_not_found', 'Камионът не е намерен.', 404);
    if (v!.ownership !== 'owned') fail('rented', 'Само на собствен камион.');
    if (await plateInUse(tx, a!.plate)) fail('plate_taken', 'Такава табела вече има.', 409);
    await tx.update(vehicles).set({ plate: a!.plate }).where(eq(vehicles.id, v!.id));
    await tx.update(plateAuctions).set({ vehicleId: v!.id }).where(eq(plateAuctions.weekKey, weekKey));
    return { plate: a!.plate };
  });
}

/** This week's auction and the player's won plates not fitted yet. */
export async function plateAuctionView(db: DbOrTx, userId: string, now: Date) {
  const week = periodWindow('weekly', now);
  const [a] = await db.select({ weekKey: plateAuctions.weekKey, plate: plateAuctions.plate, endsAt: plateAuctions.endsAt, bidCoins: plateAuctions.bidCoins, bids: plateAuctions.bids, bidUserId: plateAuctions.bidUserId, leader: users.username }).from(plateAuctions).leftJoin(users, eq(users.id, plateAuctions.bidUserId)).where(eq(plateAuctions.weekKey, week.key));
  const won = await db.select({ weekKey: plateAuctions.weekKey, plate: plateAuctions.plate }).from(plateAuctions).where(and(eq(plateAuctions.bidUserId, userId), isNull(plateAuctions.vehicleId), sql`${plateAuctions.settledAt} is not null`));
  return { auction: a ? { ...a, minBid: nextMinBid(a.bidCoins), mine: a.bidUserId === userId } : null, won };
}
