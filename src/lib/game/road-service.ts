import { haversineKm, type LatLon } from '@/lib/geo/geometry';
import { seededRandom } from './road-events';
import { isWinter, roadCondition, type RealConditions } from './winter';

/**
 * 1.4 „Пътна служба“: real mountain passes close in winter, and players open them again.
 * A pass closes for the day by its country's road condition and its height (game data on
 * real conditions); while it is closed, salt and sand loads to the town under it appear on
 * the market, and when enough tonnes arrive the pass is open again for everyone. A trip
 * whose road goes over a closed pass waits for the snowplows on the way.
 *
 * The passes are real: names, coordinates (Wikipedia) and heights.
 */
export interface MountainPass { id: string; name: string; country: string; lat: number; lon: number; altitude: number }

export const PASSES: MountainPass[] = [
  { id: 'shipka', name: 'Шипченски проход', country: 'BG', lat: 42.755, lon: 25.319, altitude: 1190 },
  { id: 'petrohan', name: 'Петрохан', country: 'BG', lat: 43.1225, lon: 23.1253, altitude: 1444 },
  { id: 'beklemeto', name: 'Беклемето (Троянски проход)', country: 'BG', lat: 42.7806, lon: 24.6058, altitude: 1520 },
  { id: 'republika', name: 'Проход на Републиката', country: 'BG', lat: 42.7972, lon: 25.675, altitude: 700 },
  { id: 'predeal', name: 'Проход Предеал', country: 'RO', lat: 45.5128, lon: 25.5722, altitude: 1033 },
  { id: 'brenner', name: 'Проход Бренер', country: 'AT', lat: 47.0033, lon: 11.5075, altitude: 1370 },
  { id: 'arlberg', name: 'Проход Арлберг', country: 'AT', lat: 47.13, lon: 10.211, altitude: 1793 },
];

export const ROAD_SERVICE = {
  /** Tonnes of salt and sand that open a closed pass again. */
  tonsToOpen: 40,
  /** Loads on the market for each closed pass (kept topped up while it is closed). */
  loadsPerPass: 3,
  tons: [18, 26] as const,
  /** Pay on top of an ordinary bulk load. */
  rewardMultiplier: 1.6,
  /** The town the loads go to is at most this far from the pass; the salt comes from at most this far. */
  townKm: 60,
  supplierKm: 400,
  /** Pass points for each tonne brought to a closed pass. */
  pointsPerTon: 60,
  /** A road within this many km of the pass goes over it. */
  routeKm: 3,
  goods: ['Сол за пътищата', 'Пясък за опесъчаване'],
} as const;

/** „Пазител на прохода“: tonnes brought to closed passes in a season; the top three get titles and ТрансКоин. */
export const PASS_GUARDIAN = { places: [{ title: 'pass-guardian', coins: 80 }, { title: 'pass-keeper', coins: 50 }, { title: 'pass-keeper', coins: 30 }] } as const;

const sofiaDate = (t: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);

/**
 * Is the pass closed by the weather today? A blizzard in its country closes every pass; ice
 * closes the high ones (from 1 300 m); snow closes a pass now and then, the higher the likelier.
 */
export function closedByWeather(pass: MountainPass, now: Date, real?: RealConditions | null): boolean {
  if (!isWinter(now) && !real?.[pass.country]) return false;
  const condition = roadCondition(pass.country, now, real);
  if (condition === 'blizzard') return true;
  if (condition === 'ice') return pass.altitude >= 1300;
  if (condition === 'snow') return seededRandom(`pass:${pass.id}:${sofiaDate(now)}`)() < Math.max(0, (pass.altitude - 900) / 1500);
  return false;
}

/** Does a road (its points) go over the pass? */
export function goesOver(points: readonly LatLon[], pass: MountainPass): boolean {
  const at: LatLon = [pass.lat, pass.lon];
  for (const p of points) if (haversineKm(p, at) <= ROAD_SERVICE.routeKm) return true;
  return false;
}

export const passById = (id: string) => PASSES.find((p) => p.id === id);
