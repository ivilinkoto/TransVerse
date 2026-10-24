import { seededRandom } from './road-events';

/**
 * The living economy and multimodal logistics (v2.0 "Светът се отваря"),
 * game data:
 * - The economic cycle: a slow wave of boom and slowdown for the whole game
 *   (half a year) and a faster one per country (a quarter), with a little
 *   noise each week. New loads pay by it (0.88–1.12).
 * - Supply: a city that ships a lot of one cargo runs short of it for a
 *   while — fewer new loads start there, and it fills up again by the hour.
 * - Intermodal containers: a truck takes a container to a rail or sea
 *   terminal, the train or ship carries it (the line's real time), and the
 *   last leg from the other terminal is a new load — first for the driver of
 *   the first leg, then for anyone. Each leg on time pays a bonus; one driver
 *   for both earns more.
 */
export const CYCLE = { min: 0.88, max: 1.12, globalAmp: 0.07, globalWeeks: 26, countryAmp: 0.04, countryWeeks: 13, noise: 0.02 } as const;

export const SUPPLY = { floor: 0.4, dropPerTon: 0.01, recoveryPerHour: 0.01 } as const;

export const INTERMODAL = { open: 6, ttlHours: 30, multiplier: 1.1, nearKm: 350, holdHours: 2, bonusShare: 0.1, sameDriverShare: 0.15 } as const;

const WEEK_MS = 7 * 86_400_000;
const weekIndex = (now: Date) => Math.floor(now.getTime() / WEEK_MS);
const phaseOf = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 1000, 7) / 1000;

/** The economy's level this week (1 = normal), for the whole game or one country. */
export function cycleIndex(now: Date, country?: string): number {
  const w = weekIndex(now);
  let v = 1 + CYCLE.globalAmp * Math.sin((2 * Math.PI * w) / CYCLE.globalWeeks) + (seededRandom(`cycle:${w}`)() * 2 - 1) * CYCLE.noise;
  if (country) v += CYCLE.countryAmp * Math.sin((2 * Math.PI * w) / CYCLE.countryWeeks + 2 * Math.PI * phaseOf(country));
  return Math.round(Math.min(CYCLE.max, Math.max(CYCLE.min, v)) * 1000) / 1000;
}

export type CyclePhase = 'boom' | 'steady' | 'slowdown';
export const cyclePhase = (index: number): CyclePhase => (index >= 1.04 ? 'boom' : index <= 0.96 ? 'slowdown' : 'steady');
export const CYCLE_LABELS: Record<CyclePhase, string> = { boom: 'Подем', steady: 'Стабилно', slowdown: 'Спад' };

/** Supply after shipping `tons` (never below the floor). */
export const supplyAfter = (supply: number, tons: number) => Math.max(SUPPLY.floor, supply - tons * SUPPLY.dropPerTon);
