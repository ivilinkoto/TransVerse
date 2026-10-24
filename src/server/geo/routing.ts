import polyline from '@mapbox/polyline';
import { closedCrossing, detourFor, type Waypoint } from '@/lib/geo/borders';
import { cumulativeKm, haversineKm, simplify, type LatLon } from '@/lib/geo/geometry';

/**
 * Routing provider abstraction. The game never talks to a routing service
 * directly — only through this module — so the provider can be swapped
 * (public Valhalla → self-hosted Valhalla → commercial API) without touching
 * game logic.
 */

/** 'truck_cheap' (v1.6): a truck route that avoids tolls and keeps off the motorways where it can — slower, no road charges. */
export type RouteProfile = 'truck' | 'truck_cheap' | 'van';

export interface RoutePoint {
  lat: number;
  lon: number;
  country: string;
}

export interface RouteResult {
  provider: 'valhalla' | 'approximate';
  distanceKm: number;
  durationS: number;
  hasToll: boolean;
  borders: { km: number; from: string; to: string }[];
  countries: string[];
  /** Encoded polyline (precision 6) of the simplified road geometry; null for approximations. */
  geometry: string | null;
}

export interface RoutingProvider {
  readonly name: RouteResult['provider'];
  /** `via`: border crossings the route must go through (v2.0, round a closed border). */
  route(from: RoutePoint, to: RoutePoint, profile: RouteProfile, via?: readonly Waypoint[]): Promise<RouteResult>;
}

export class RoutingUnavailableError extends Error {}

/** Explicit approximation: great-circle distance × road factor. Never presented as a real road route. */
export const approximateProvider: RoutingProvider = {
  name: 'approximate',
  async route(from, to, profile, via = []) {
    const factor = profile === 'truck_cheap' ? 1.2 : 1.25;
    const speed = profile === 'van' ? 80 : profile === 'truck_cheap' ? 56 : 68;
    // Legs between the points; a border on a waypoint, or halfway along a leg whose ends differ.
    const points = [{ ...from, at: from.country, next: from.country }, ...via.map((w) => ({ lat: w.lat, lon: w.lon, at: w.from, next: w.to })), { ...to, at: to.country, next: to.country }];
    let km = 0;
    const borders: RouteResult['borders'] = [];
    for (let i = 0; i + 1 < points.length; i++) {
      const [p, q] = [points[i]!, points[i + 1]!];
      const leg = haversineKm([p.lat, p.lon], [q.lat, q.lon]) * factor;
      if (p.next !== q.at) borders.push({ km: Math.round(km + leg / 2), from: p.next, to: q.at });
      km += leg;
      if (i + 1 < points.length - 1 && q.at !== q.next) borders.push({ km: Math.round(km), from: q.at, to: q.next });
    }
    const countries = [from.country, ...borders.map((b) => b.to)];
    return {
      provider: 'approximate',
      distanceKm: Math.round(km * 10) / 10,
      durationS: Math.round((km / speed) * 3600),
      hasToll: profile === 'truck',
      borders,
      countries: [...new Set(countries)],
      geometry: null,
    };
  },
};

interface ValhallaAdmin {
  country_code: string;
}
interface ValhallaResponse {
  trip?: {
    status: number;
    status_message: string;
    legs: {
      shape: string;
      summary: {
        length: number;
        time: number;
        has_toll: boolean;
        admins?: ValhallaAdmin[];
        admin_crossings?: { from_admin_index: number; to_admin_index: number; begin_shape_index: number }[];
      };
    }[];
  };
  error?: string;
}

/** Valhalla (OpenStreetMap data) with real truck costing: dimensions, weight, tolls, borders. */
export function valhallaProvider(baseUrl: string, timeoutMs = 20_000): RoutingProvider {
  return {
    name: 'valhalla',
    async route(from, to, profile, via = []) {
      // City centres are often closed to heavy trucks; real freight is loaded on the
      // nearest major road / industrial area, so snap to secondary roads or better.
      const snap = profile !== 'van' ? { radius: 3000, search_filter: { min_road_class: 'secondary' } } : {};
      const body = {
        locations: [
          { lat: from.lat, lon: from.lon, ...snap },
          ...via.map((w) => ({ lat: w.lat, lon: w.lon, type: 'through', radius: 5000 })),
          { lat: to.lat, lon: to.lon, ...snap },
        ],
        costing: profile === 'van' ? 'auto' : 'truck',
        costing_options: profile === 'van' ? undefined : { truck: { height: 4, width: 2.55, length: 16.5, weight: 40, axle_load: 11.5, ...(profile === 'truck_cheap' ? { use_tolls: 0, use_highways: 0.2 } : {}) } },
        units: 'kilometers',
        directions_type: 'none',
        admin_crossings: true,
      };
      let response: Response;
      try {
        response = await fetch(`${baseUrl.replace(/\/$/, '')}/route`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'TransVerse/0.1 (game; contact via repository)' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new RoutingUnavailableError(`Valhalla unreachable: ${(error as Error).message}`);
      }
      if (!response.ok) throw new RoutingUnavailableError(`Valhalla HTTP ${response.status}`);
      const data = (await response.json()) as ValhallaResponse;
      const leg = data.trip?.legs[0];
      if (!data.trip || data.trip.status !== 0 || !leg) throw new RoutingUnavailableError(`Valhalla: ${data.error ?? data.trip?.status_message}`);

      const shape = polyline.decode(leg.shape, 6) as LatLon[];
      const cumulative = cumulativeKm(shape);
      const scale = cumulative.at(-1)! > 0 ? leg.summary.length / cumulative.at(-1)! : 1;
      const admins = leg.summary.admins ?? [];
      const borders: RouteResult['borders'] = [];
      for (const c of leg.summary.admin_crossings ?? []) {
        const a = admins[c.from_admin_index]?.country_code;
        const b = admins[c.to_admin_index]?.country_code;
        if (a && b && a !== b) borders.push({ km: Math.round((cumulative[c.begin_shape_index] ?? 0) * scale * 10) / 10, from: a, to: b });
      }
      const countries = [...new Set(admins.map((a) => a.country_code))];
      return {
        provider: 'valhalla',
        distanceKm: Math.round(leg.summary.length * 10) / 10,
        durationS: Math.round(leg.summary.time),
        hasToll: leg.summary.has_toll,
        borders,
        countries: countries.length ? countries : [from.country],
        geometry: polyline.encode(simplify(shape, 0.0008), 6),
      };
    },
  };
}

/**
 * A route that keeps to open borders (v2.0): when the road would cross a
 * closed border, it goes round through the real open crossings. A provider
 * that still crosses a closed border is treated as unavailable.
 */
export async function routeOpen(provider: RoutingProvider, from: RoutePoint, to: RoutePoint, profile: RouteProfile): Promise<RouteResult> {
  const direct = await provider.route(from, to, profile);
  const closed = closedCrossing(direct.borders);
  if (!closed) return direct;
  const round = await provider.route(from, to, profile, detourFor(closed.from, closed.to));
  if (closedCrossing(round.borders)) throw new RoutingUnavailableError(`no open border from ${from.country} to ${to.country}`);
  return round;
}

export function configuredProvider(): RoutingProvider {
  const kind = process.env.ROUTING_PROVIDER ?? 'approximate';
  if (kind === 'valhalla') return valhallaProvider(process.env.VALHALLA_URL ?? 'https://valhalla1.openstreetmap.de');
  return approximateProvider;
}
