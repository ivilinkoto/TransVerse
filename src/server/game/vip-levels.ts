/**
 * 1.3.2.2: the VIP level kept on the player (users.vip_level), worked out again
 * from the paid payments after every payment and refund (src/lib/game/vip-levels.ts).
 */
import { and, eq, sql } from 'drizzle-orm';
import { levelForSpent } from '@/lib/game/vip-levels';
import type { DbOrTx } from '@/server/db/client';
import { companies, payments, users } from '@/server/db/schema';

/** What a player has paid in the shop (euro cents; refunded payments do not count). */
export async function spentCents(db: DbOrTx, userId: string) {
  const [row] = await db.select({ n: sql<number>`coalesce(sum(${payments.amountCents}), 0)::int` }).from(payments).where(and(eq(payments.userId, userId), eq(payments.status, 'paid')));
  return row?.n ?? 0;
}

/** Works the level out again (never below the kept floor) and stores it; returns it. */
export async function refreshVipLevel(db: DbOrTx, userId: string) {
  const [u] = await db.select({ floor: users.vipLevelFloor }).from(users).where(eq(users.id, userId));
  const level = Math.max(u?.floor ?? 0, levelForSpent(await spentCents(db, userId)));
  await db.update(users).set({ vipLevel: level }).where(eq(users.id, userId));
  return level;
}

/** The VIP level of an account's owner. */
export async function ownerVipLevel(db: DbOrTx, companyId: string) {
  const [row] = await db.select({ level: users.vipLevel }).from(companies).innerJoin(users, eq(users.id, companies.ownerId)).where(eq(companies.id, companyId));
  return row?.level ?? 0;
}
