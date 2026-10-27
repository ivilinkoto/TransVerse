import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { FEATURES } from '@/lib/game/features';
import { closeDb } from '@/server/db/client';
import { notifications, seasonalQuests } from '@/server/db/schema';
import { HALLOWEEN_DEF } from '@/server/game/halloween';
import { remindUnclaimedHoliday, unclaimedHolidayQuests } from '@/server/game/holiday';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

describe('v1.1.3', () => {
  it('registers its features under 1.1.3', () => {
    for (const id of ['rent_vs_buy', 'help_faq', 'notification_filter'] as const) expect(FEATURES[id]).toBe('1.1.3');
  });

  it('after the Halloween event, players with finished quests not taken get one reminder', async () => {
    const p = await newPlayer();
    const [first, second] = HALLOWEEN_DEF.quests;
    await db().insert(seasonalQuests).values([
      { userId: p.userId, quest: `${HALLOWEEN_DEF.key}:${first!.id}`, progress: first!.target },
      { userId: p.userId, quest: `${HALLOWEEN_DEF.key}:${second!.id}`, progress: 0 },
    ]);
    expect((await unclaimedHolidayQuests(db(), HALLOWEEN_DEF, p.userId)).get(p.userId)).toBe(1);

    const end = HALLOWEEN_DEF.eventWindow().endsAt.getTime();
    const mine = async () => (await db().select().from(notifications).where(and(eq(notifications.userId, p.userId), eq(notifications.href, HALLOWEEN_DEF.href)))).length;
    // Before the end and after the week: nothing.
    await remindUnclaimedHoliday(db(), HALLOWEEN_DEF, new Date(end - 60_000));
    await remindUnclaimedHoliday(db(), HALLOWEEN_DEF, new Date(end + 8 * 86_400_000));
    expect(await mine()).toBe(0);
    await remindUnclaimedHoliday(db(), HALLOWEEN_DEF, new Date(end + 3_600_000));
    expect(await mine()).toBe(1);

    // Taken: no longer counted.
    await db().update(seasonalQuests).set({ claimedAt: new Date() }).where(eq(seasonalQuests.userId, p.userId));
    expect((await unclaimedHolidayQuests(db(), HALLOWEEN_DEF, p.userId)).get(p.userId)).toBeUndefined();
  });
});
