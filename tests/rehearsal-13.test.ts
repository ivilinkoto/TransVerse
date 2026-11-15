import { afterAll, describe, expect, it } from 'vitest';

/**
 * Dress rehearsal of 1.3 „Зимен път“ with the real dates (no feature mocks): on
 * 12.11.2026 at 10:00 everything of 1.3 turns on for an ordinary player, not a
 * minute earlier; the staff have it before. The new systems answer for a player
 * at the release time.
 */
import { FEATURES, featureLive, type FeatureId } from '@/lib/game/features';
import { latestPublished, releaseByVersion } from '@/lib/game/releases';
import { crisisAt } from '@/lib/game/crises';
import { trekUnlocked } from '@/lib/game/winter-trek';
import { closeDb } from '@/server/db/client';
import { featureFor } from '@/server/features';
import { dailyRouteView } from '@/server/game/daily-route';
import { winterTrekView } from '@/server/game/winter-trek';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const at = (s: string) => new Date(s);
const BEFORE = at('2026-11-12T09:59:00+02:00');
const LIVE = at('2026-11-12T10:00:00+02:00');
const NEW_13: FeatureId[] = ['game_ui', 'winter_trek', 'daily_route', 'mascot', 'night_run', 'driver_skills', 'player_workshops', 'world_crises', 'bus_lines'];

describe('rehearsal: 1.3 „Зимен път“ on 12.11.2026 at 10:00', () => {
  it('the release is dated and is the latest from 10:00', () => {
    expect(releaseByVersion('1.3')?.publishedAt).toBe('2026-11-12T10:00:00+02:00');
    expect(latestPublished(LIVE)?.version).toBe('1.3');
    expect(latestPublished(BEFORE)?.version).not.toBe('1.3');
  });

  it('every 1.3 feature is off at 09:59 and on at 10:00 for players, on for the staff before', () => {
    const all = (Object.keys(FEATURES) as FeatureId[]).filter((f) => FEATURES[f] === '1.3');
    for (const f of NEW_13) expect(all, f).toContain(f);
    for (const f of all) {
      expect(featureLive(f, BEFORE), f).toBe(false);
      expect(featureLive(f, LIVE), f).toBe(true);
      expect(featureLive(f, BEFORE, true), f).toBe(true);
    }
  });

  it('for an ordinary player the new systems answer from 10:00', async () => {
    const p = await newPlayer();
    for (const f of NEW_13) {
      expect(await featureFor(db(), p.userId, f, BEFORE), f).toBe(false);
      expect(await featureFor(db(), p.userId, f, LIVE), f).toBe(true);
    }
    expect(await winterTrekView(db(), p.userId, BEFORE)).toBeNull();
    const trek = (await winterTrekView(db(), p.userId, LIVE))!;
    expect(trek.open).toBe(1);
    expect(trek.steps[0]!.state).toBe('current');
    expect(trekUnlocked(at('2026-11-13T08:00:00+02:00'))).toBe(2);
    const route = await dailyRouteView(db(), p.userId, LIVE);
    expect(route.cities).toHaveLength(6);
    // The first crisis begins the next morning.
    expect(crisisAt(LIVE)).toBeNull();
    expect(crisisAt(at('2026-11-13T07:00:00+02:00'))?.id).toBe('port_strike');
  });
});
