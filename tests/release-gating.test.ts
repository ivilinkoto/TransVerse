import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { FEATURES, featureDate, featureLive, liveFeatures } from '@/lib/game/features';
import { compareVersions, releaseByVersion } from '@/lib/game/releases';
import { closeDb } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { featureFor, requireFeature } from '@/server/features';
import { GameError } from '@/server/game/errors';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const release = new Date(releaseByVersion('1.2')!.publishedAt);
const before = new Date(release.getTime() - 60_000);
const after = new Date(release.getTime() + 60_000);

describe('release gating', () => {
  it('a feature goes live for players on its release date, for staff at once', () => {
    expect(featureDate('convoy')).toEqual(release);
    expect(featureLive('convoy', before)).toBe(false);
    expect(featureLive('convoy', before, true)).toBe(true);
    expect(featureLive('convoy', release)).toBe(true);
    // Before 1.2 only the earlier point releases (1.1.1) are on.
    const early = (Object.keys(FEATURES) as (keyof typeof FEATURES)[]).filter((id) => compareVersions(FEATURES[id], '1.2') < 0);
    expect(early.length).toBeGreaterThan(0);
    expect(Object.entries(liveFeatures(before)).every(([id, on]) => on === early.includes(id as keyof typeof FEATURES))).toBe(true);
    expect(Object.values(liveFeatures(before, true)).every(Boolean)).toBe(true);
    expect(Object.keys(liveFeatures(after))).toEqual(Object.keys(FEATURES));
    // After the 1.2 release its features (and the earlier ones) are on; a later update's stay off until its own date.
    const live = liveFeatures(after);
    expect((Object.keys(FEATURES) as (keyof typeof FEATURES)[]).every((id) => live[id] === (compareVersions(FEATURES[id], '1.2') <= 0))).toBe(true);
    expect(featureLive('company_plot', after)).toBe(false);
  });

  it('refuses an action of an unreleased feature to players, not to staff', () => {
    const refused = (role: string, now: Date, asPlayer = false) => {
      try {
        requireFeature('transfers', { role, asPlayer }, now);
        return null;
      } catch (e) {
        return e instanceof GameError ? e.code : 'other';
      }
    };
    expect(refused('player', before)).toBe('not_released');
    expect(refused('admin', before)).toBeNull();
    // 1.1.2: staff looking at the game as a player are refused like a player.
    expect(refused('admin', before, true)).toBe('not_released');
    expect(refused('support', before)).toBeNull();
    expect(refused('player', after)).toBeNull();
  });

  it('checks the player in the database for server-side passives', async () => {
    const p = await newPlayer();
    const s = await newPlayer();
    await db().update(users).set({ role: 'admin' }).where(eq(users.id, s.userId));
    expect(await featureFor(db(), p.userId, 'backhaul', before)).toBe(false);
    expect(await featureFor(db(), s.userId, 'backhaul', before)).toBe(true);
    expect(await featureFor(db(), p.userId, 'backhaul', after)).toBe(true);
  });
});
