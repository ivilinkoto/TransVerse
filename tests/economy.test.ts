import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { companyXpForLevel } from '@/lib/game/company';
import { COMPANY_XP_SHARE, FLEET_XP_SHARE } from '@/lib/game/progression';
import { gameDurationMinutes } from '@/lib/game/schedule';
import { closeDb } from '@/server/db/client';
import { xpEntries } from '@/server/db/schema';
import { awardXp, xpBySource } from '@/server/game/progression';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

describe('v1.3 economy pace', () => {
  it('trips take twice as long, fleets and companies level slower', () => {
    expect(gameDurationMinutes(500)).toBe(60);
    expect(FLEET_XP_SHARE).toBe(0.1);
    expect(COMPANY_XP_SHARE).toBe(0.5);
    expect(companyXpForLevel(10)).toBeGreaterThan(400_000);
  });

  it('every XP grant is logged with its source', async () => {
    const p = await newPlayer();
    await db().transaction(async (tx) => {
      await awardXp(tx, p.userId, 300, 'delivery');
      await awardXp(tx, p.userId, 30, 'fleet');
      await awardXp(tx, p.userId, 20, 'fleet');
    });
    expect(await db().select().from(xpEntries).where(eq(xpEntries.userId, p.userId))).toHaveLength(3);
    const by = await xpBySource(db(), p.userId);
    expect(by.map((r) => [r.reason, r.xp, r.n])).toEqual([['delivery', 300, 1], ['fleet', 50, 2]]);
  });
});
