/**
 * 1.2.3.6 „Чиста карта“: what each player chooses to see on the map.
 * Kept in the profile (users.uiPrefs.mapLayers) so it follows the player to the phone.
 */
export const MAP_LAYER_KEYS = ['mine', 'company', 'friends', 'others', 'movingOnly', 'plates', 'depots', 'routes', 'weather'] as const;
export type MapLayerKey = (typeof MAP_LAYER_KEYS)[number];
export type MapLayers = Record<MapLayerKey, boolean>;

export const DEFAULT_MAP_LAYERS: MapLayers = { mine: true, company: true, friends: true, others: true, movingOnly: false, plates: true, depots: true, routes: true, weather: true };

/** The stored choice over the defaults (keys added later default to the table above). */
export function mapLayers(stored?: Partial<MapLayers> | null): MapLayers {
  const out = { ...DEFAULT_MAP_LAYERS };
  for (const k of MAP_LAYER_KEYS) if (typeof stored?.[k] === 'boolean') out[k] = stored[k]!;
  return out;
}

/** Other players' trucks drawn at once (the nearest to the view); friends and the company are always drawn. */
export const CROWD_CAP = 150;

/** The `cap` items nearest to `center` (a cheap flat distance is enough to rank them), in their original order. */
export function nearestFirst<T>(items: T[], center: [number, number] | null, cap: number, pos: (item: T) => [number, number], keep?: (item: T) => boolean): T[] {
  if (items.length <= cap || !center) return items.slice(0, Math.max(cap, 0));
  const k = Math.cos((center[0] * Math.PI) / 180);
  const dist = (p: [number, number]) => (p[0] - center[0]) ** 2 + ((p[1] - center[1]) * k) ** 2;
  const ranked = items.map((item, i) => ({ i, d: keep?.(item) ? -1 : dist(pos(item)) })).sort((a, b) => a.d - b.d).slice(0, cap);
  return ranked.sort((a, b) => a.i - b.i).map((r) => items[r.i]!);
}
