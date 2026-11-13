import polyline from '@mapbox/polyline';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { memberBonuses } from '@/lib/game/company';
import { passById } from '@/lib/game/road-service';
import { closeDb } from '@/server/db/client';
import { jobState } from '@/server/db/schema';
import { FEATURES_OFF_KEY, featureOn } from '@/server/feature-off';
import { staffBonuses } from '@/server/game/base-staff';
import { closedPassOnRoute } from '@/server/game/road-service';
import { db } from './helpers';

afterAll(() => closeDb());

const off = (ids: string[]) => db().insert(jobState).values({ key: FEATURES_OFF_KEY, value: { ids } }).onConflictDoUpdate({ target: jobState.key, set: { value: { ids } } });

/** 1.4: the admins' switch stops the effects that do not come from a player's own request. */
describe('1.4 kill switches', () => {
  it('road service and base staff stop when switched off', async () => {
    const now = new Date('2026-12-18T11:00:00+02:00');
    const shipka = passById('shipka')!;
    const road = polyline.encode([[42.6, 25.3], [shipka.lat, shipka.lon]], 6);
    const b = memberBonuses({ service: 1 });
    try {
      await off([]);
      expect(await featureOn(db(), 'road_service', now)).toBe(true);
      expect(await closedPassOnRoute(db(), road, now, { BG: 'blizzard' })).not.toBeNull();
      await off(['road_service', 'base_staff']);
      expect(await featureOn(db(), 'road_service', now)).toBe(false);
      expect(await closedPassOnRoute(db(), road, now, { BG: 'blizzard' })).toBeNull();
      expect(await staffBonuses(db(), '00000000-0000-0000-0000-000000000000', b, now)).toEqual(b);
    } finally {
      await db().delete(jobState).where(eq(jobState.key, FEATURES_OFF_KEY));
    }
  });
});
