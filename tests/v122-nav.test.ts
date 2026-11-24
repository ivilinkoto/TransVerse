import { describe, expect, it } from 'vitest';

import { afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb } from '@/server/db/client';
import { companies, vehicles } from '@/server/db/schema';
import { nowList } from '@/server/game/now';
import { db, newPlayer } from './helpers';

describe('1.2.2 Начало „Сега“', () => {
  afterAll(() => closeDb());
  it('lists the free truck first and a worn one as a repair, one button each', async () => {
    const p = await newPlayer();
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [u] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc!.id));
    const user = { id: p.userId, loginStreak: 0, dailyClaimKey: null, uiPrefs: {} };
    const list = await nowList(db(), user, acc!.id, new Date(), {});
    expect(list[0]?.tone).toBe('hot');
    expect(list.every((i) => i.href.startsWith('/game'))).toBe(true);
    await db().update(vehicles).set({ condition: 30 }).where(eq(vehicles.id, u!.id));
    const worn = await nowList(db(), user, acc!.id, new Date(), {});
    expect(worn.find((i) => i.tone === 'warn')?.href).toBe(`/game/fleet?truck=${u!.id}&tab=service`);
    expect(worn.length).toBeLessThanOrEqual(6);
  });
});
