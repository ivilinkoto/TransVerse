import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));

import { COLLECTIONS, ITEMS } from '@/lib/game/items';
import { releaseByVersion } from '@/lib/game/releases';
import { closeDb } from '@/server/db/client';
import { friendships, userBadges, users } from '@/server/db/schema';
import { grantItem } from '@/server/game/inventory';
import { foundItems, giftItem, openGift } from '@/server/game/item-trade';
import { db, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const give = (userId: string, itemId: keyof typeof ITEMS) => db().transaction((tx) => grantItem(tx, userId, itemId, 1, 'test', `t1211:${itemId}:${userId}:${Math.random()}`));

describe('1.2.1.1 collections count only own finds', () => {
  it('a present neither fills the album nor completes a collection', async () => {
    const a = await playerWithCompany();
    const b = await playerWithCompany();
    await db().update(users).set({ level: 5 }).where(eq(users.id, a.userId));
    await db().insert(friendships).values({ requesterId: a.userId, addresseeId: b.userId, status: 'accepted' });
    const c = COLLECTIONS.find((x) => x.id === 'winter')!;
    // B found all but the last item; A gives the last one.
    for (const i of c.items.slice(0, -1)) await give(b.userId, i);
    const last = c.items.at(-1)!;
    await give(a.userId, last);
    const { id } = await giftItem(db(), a.userId, { toUserId: b.userId, itemId: last });
    await openGift(db(), b.userId, id);
    expect((await foundItems(db(), b.userId)).has(last)).toBe(false);
    expect(await db().select().from(userBadges).where(and(eq(userBadges.userId, b.userId), eq(userBadges.badge, c.badge)))).toHaveLength(0);
    // Found by B: the collection is complete.
    await give(b.userId, last);
    expect(await db().select().from(userBadges).where(and(eq(userBadges.userId, b.userId), eq(userBadges.badge, c.badge)))).toHaveLength(1);
  });

  it('the release notes the fix', () => {
    expect(releaseByVersion('1.2.1.1')).toBeTruthy();
  });
});
