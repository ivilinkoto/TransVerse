import { and, count, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import type { Database } from '@/server/db/client';
import { companies, contractGifts, contracts, friendships, users } from '@/server/db/schema';
import { t } from '@/i18n/t';
import { companyForUser } from './company';
import { fail } from './errors';
import { notify } from './notify';

/**
 * 1.1.4.2 „Подари курс“: an open load on the board goes to a friend — kept for
 * them for two hours and paying 5% more. Three gifts a day.
 */
export const GIFT = { hours: 2, share: 0.05, perDay: 3 };

export async function giftLoad(db: Database, userId: string, contractId: string, friendId: string, now = new Date()) {
  if (friendId === userId) fail('self_gift', t('Не можеш да подариш курс на себе си.'));
  return db.transaction(async (tx) => {
    const [friend] = await tx
      .select({ id: friendships.id })
      .from(friendships)
      .where(and(eq(friendships.status, 'accepted'), or(and(eq(friendships.requesterId, userId), eq(friendships.addresseeId, friendId)), and(eq(friendships.requesterId, friendId), eq(friendships.addresseeId, userId)))));
    if (!friend) fail('not_friends', t('Можеш да подариш курс само на приятел.'), 403);
    const [{ n = 0 } = {}] = await tx.select({ n: count() }).from(contractGifts).where(and(eq(contractGifts.fromUserId, userId), gt(contractGifts.createdAt, new Date(now.getTime() - 86_400_000))));
    if (n >= GIFT.perDay) fail('gifts_full', t('Най-много {0} подаръка на ден.', GIFT.perDay));
    const [theirs] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, friendId));
    if (!theirs) fail('no_company', t('Приятелят ти още няма компания.'));
    const mine = await companyForUser(tx, userId);
    // Only an ordinary open load — not one kept for someone else, not a private one.
    const [c] = await tx
      .update(contracts)
      .set({ reservedByCompanyId: theirs!.id, reservedUntil: new Date(now.getTime() + GIFT.hours * 3_600_000), rewardCents: sql`round(${contracts.rewardCents} * ${sql.raw(String(1 + GIFT.share))})` })
      .where(and(eq(contracts.id, contractId), eq(contracts.status, 'open'), gt(contracts.expiresAt, now), isNull(contracts.tradeCompanyId), isNull(contracts.tenderId), isNull(contracts.clientContractId), eq(contracts.shady, false), or(isNull(contracts.reservedByCompanyId), lte(contracts.reservedUntil, now), eq(contracts.reservedByCompanyId, mine.id))))
      .returning({ goods: contracts.goods });
    if (!c) fail('contract_unavailable', t('Поръчката вече не е налична.'), 409);
    await tx.insert(contractGifts).values({ contractId, fromUserId: userId, toUserId: friendId }).onConflictDoNothing();
    const [me] = await tx.select({ username: users.username }).from(users).where(eq(users.id, userId));
    await notify(tx, friendId, 'success', () => t('🎁 {0} ти подари курс', me?.username ?? ''), () => t('{0} — пази се за теб 2 часа, +5% плащане.', c!.goods), `/game/contracts?gift=${contractId}`);
    return { ok: true };
  });
}

/** How many loads a player has given (the thanks shown on the profile). */
export async function giftsGiven(db: Database, userId: string) {
  const [{ n = 0 } = {}] = await db.select({ n: count() }).from(contractGifts).where(eq(contractGifts.fromUserId, userId));
  return n;
}
