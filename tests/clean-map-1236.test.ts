import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { FEATURES, featureLive } from '@/lib/game/features';
import { CROWD_CAP, DEFAULT_MAP_LAYERS, mapLayers, nearestFirst } from '@/lib/game/map-layers';
import { POSTCARD, postcardReason, postcardScene } from '@/lib/game/postcard';
import { releaseByVersion } from '@/lib/game/releases';
import { closeDb } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { setUiPrefs } from '@/server/game/ui-prefs';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

describe('1.2.3.6 „Чиста карта“: rules', () => {
  it('is live with its release', () => {
    const at = new Date(releaseByVersion('1.3')!.publishedAt);
    for (const f of ['map_layers', 'truck_3d_view', 'depot_3d', 'game_ui', 'delivery_postcard'] as const) {
      expect(FEATURES[f]).toBe('1.3');
      expect(featureLive(f, at)).toBe(true);
    }
  });

  it('map layers: the defaults show everything but „only moving“, a stored choice wins', () => {
    expect(mapLayers(null)).toEqual(DEFAULT_MAP_LAYERS);
    expect(DEFAULT_MAP_LAYERS.movingOnly).toBe(false);
    expect(mapLayers({ others: false, plates: false })).toMatchObject({ others: false, plates: false, mine: true, friends: true });
  });

  it('keeps the nearest trucks (and the one in focus) in their order', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: i, p: [42 + i, 23] as [number, number] }));
    expect(nearestFirst(items, [42, 23], 3, (x) => x.p).map((x) => x.id)).toEqual([0, 1, 2]);
    expect(nearestFirst(items, [51, 23], 3, (x) => x.p).map((x) => x.id)).toEqual([7, 8, 9]);
    expect(nearestFirst(items, [42, 23], 3, (x) => x.p, (x) => x.id === 9).map((x) => x.id)).toEqual([0, 1, 9]);
    expect(nearestFirst(items, null, 20, (x) => x.p)).toHaveLength(10);
    expect(CROWD_CAP).toBe(150);
  });

  it('postcards: a new city or a long trip', () => {
    expect(postcardReason(true, 100)).toBe('first_city');
    expect(postcardReason(false, POSTCARD.longKm)).toBe('long_trip');
    expect(postcardReason(false, 300)).toBeNull();
    expect(postcardScene('first_city', new Date('2026-12-20T10:00:00Z'))).toBe('snow');
    expect(postcardScene('long_trip', new Date('2026-06-20T10:00:00Z'))).toBe('sunset');
  });
});

describe('1.2.3.6 „Чиста карта“: the game', () => {
  it('keeps the map layers in the profile, one switch at a time', async () => {
    const p = await newPlayer('Sofia');
    await setUiPrefs(db(), p.userId, { mapLayers: { others: false } });
    await setUiPrefs(db(), p.userId, { mapLayers: { plates: false } });
    const [u] = await db().select({ prefs: users.uiPrefs }).from(users).where(eq(users.id, p.userId));
    expect(u!.prefs.mapLayers).toEqual({ others: false, plates: false });
  });
});

