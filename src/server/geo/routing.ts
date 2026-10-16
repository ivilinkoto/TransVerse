import polyline from '@mapbox/polyline';
import { cumulativeKm, haversineKm, simplify, type LatLon } from '@/lib/geo/geometry';

/**
 * Routing provider abstraction. The game never talks to a routing service
 * directly — only through this module — so the provider can be swapped
 * (public Valhalla → self-hosted Valhalla → commercial API) without touching
 * game logic.
 */

export type RouteProfile = 'truck' | 'van';

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
  route(from: RoutePoint, to: RoutePoint, profile: RouteProfile): Promise<RouteResult>;
}

export class RoutingUnavailableError extends Error {}

/** Explicit approximation: great-circle distance × road factor. Never presented as a real road route. */
export const approximateProvider: RoutingProvider = {
  name: 'approximate',
  async route(from, to, profile) {
    const km = haversineKm([from.lat, from.lon], [to.lat, to.lon]) * 1.25;
    const speed = profile === 'van' ? 80 : 68;
    const crossing = from.country !== to.country;
    return {
      provider: 'approximate',
      distanceKm: Math.round(km * 10) / 10,
      durationS: Math.round((km / speed) * 3600),
      hasToll: profile === 'truck',
      borders: crossing ? [{ km: Math.round(km / 2), from: from.country, to: to.country }] : [],
      countries: crossing ? [from.country, to.country] : [from.country],
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
    async route(from, to, profile) {
      const body = {
        locations: [
          { lat: from.lat, lon: from.lon },
          { lat: to.lat, lon: to.lon },
        ],
        costing: profile === 'truck' ? 'truck' : 'auto',
        costing_options: profile === 'truck' ? { truck: { height: 4, width: 2.55, length: 16.5, weight: 40, axle_load: 11.5 } } : undefined,
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

export function configuredProvider(): RoutingProvider {
  const kind = process.env.ROUTING_PROVIDER ?? 'approximate';
  if (kind === 'valhalla') return valhallaProvider(process.env.VALHALLA_URL ?? 'https://valhalla1.openstreetmap.de');
  return approximateProvider;
}
