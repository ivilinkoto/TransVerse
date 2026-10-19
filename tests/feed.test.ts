import { and, eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/server/db/client';
import { friendships, notifications } from '@/server/db/schema';
import { GameError } from '@/server/game/errors';
import { addFeed, cheer, friendsFeed } from '@/server/game/feed';
import { awardXp } from '@/server/game/progression';
import { xpForLevel } from '@/lib/game/progression';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));

describe('friends feed', () => {
  it('friends see each other\'s moments; "Браво" once, and the author hears it', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    const stranger = await newPlayer();
    await db().insert(friendships).values({ requesterId: a.userId, addresseeId: b.userId, status: 'accepted' });
    await db().transaction((tx) => awardXp(tx, a.userId, xpForLevel(3)));
    await addFeed(db(), { userId: a.userId, kind: 'trip', text: 'достави Мебели до Варна (640 км)' });

    const feed = await friendsFeed(db(), b.userId);
    expect(feed.map((f) => f.text)).toEqual(expect.arrayContaining(['достави Мебели до Варна (640 км)', 'достигна ниво 3']));
    expect(await friendsFeed(db(), stranger.userId)).toHaveLength(0);

    const trip = feed.find((f) => f.kind === 'trip')!;
    expect((await cheer(db(), b.userId, trip.id)).cheered).toBe(true);
    expect((await cheer(db(), b.userId, trip.id)).cheered).toBe(false);
    expect(await code(cheer(db(), a.userId, trip.id))).toBe('self');
    const told = await db().select().from(notifications).where(and(eq(notifications.userId, a.userId), like(notifications.title, '%те поздрави%')));
    expect(told).toHaveLength(1);
    expect((await friendsFeed(db(), b.userId)).find((f) => f.id === trip.id)).toMatchObject({ cheers: 1, cheered: true });
  });
});
