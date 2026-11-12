/**
 * 1.4 „Градски куриер“: the street graphs of three city centres (OpenStreetMap, built by
 * scripts/geo/city-streets.ts) and how they are described. Data © OpenStreetMap contributors (ODbL).
 */
export type LatLon = [number, number];

/** Road kinds in the order the graph files use (the index is stored). */
export const ROAD_KINDS = ['trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street'] as const;
/** Speed a delivery van keeps on each kind, km/h (city traffic, game data). */
export const KIND_SPEED = [45, 40, 35, 30, 25, 22, 12] as const;

/** An edge: from, to, length (m), kind index, one-way (1: only from → to), street name index (−1: none), inner points [lat, lon, lat, lon…]. */
export type StreetEdge = [number, number, number, number, number, number, number[]];
export interface StreetGraph { city: string; depot: number; nodes: LatLon[]; edges: StreetEdge[]; names: string[] }

export interface CourierCity { id: 'sofia' | 'plovdiv' | 'varna'; name: string; bbox: readonly [number, number, number, number]; centre: LatLon }

/** The centres (south, west, north, east) and the centre point the depot is nearest to (GeoNames). */
export const COURIER_CITIES: CourierCity[] = [
  { id: 'sofia', name: 'София', bbox: [42.684, 23.3, 42.711, 23.342], centre: [42.69751, 23.32415] },
  { id: 'plovdiv', name: 'Пловдив', bbox: [42.13, 24.73, 42.156, 24.77], centre: [42.15, 24.75] },
  { id: 'varna', name: 'Варна', bbox: [43.192, 27.89, 43.218, 27.93], centre: [43.21667, 27.91667] },
];
export const courierCity = (id: string) => COURIER_CITIES.find((c) => c.id === id);
