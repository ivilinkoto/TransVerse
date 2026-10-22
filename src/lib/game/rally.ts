/**
 * Weekly rally (v1.4, game data): every week one real route between two big
 * cities. Each player may run it once, with the same light load; the time
 * on the loaded leg (from loading to unloading) and the fuel (or energy)
 * cost per 100 km are measured. The three fastest and the three most
 * economical get money and ТрансКоин when the week ends.
 */
export const RALLY = {
  minKm: 300,
  maxKm: 650,
  /** Bigger cities only (the start and the finish are announced). */
  minPopulation: 150_000,
  cargo: 'pallets' as const,
  goods: 'Рали пакет',
  tons: 1,
  /** Pay for the run itself, per km of the route. */
  rewardCentsPerKm: 120,
  prizes: [
    { cents: 4_000_00, coins: 25 },
    { cents: 2_500_00, coins: 15 },
    { cents: 1_500_00, coins: 10 },
  ],
} as const;

export type RallyCategory = 'fastest' | 'eco';

export const RALLY_CATEGORIES: Record<RallyCategory, string> = {
  fastest: 'Най-бърз',
  eco: 'Най-икономичен',
};

export interface RallyResult {
  userId: string;
  minutes: number;
  fuelCentsPer100: number;
  finishedAt: Date;
}

/** Rankings: by the loaded-leg minutes / by the cost per 100 km; ties go to who finished first. */
export function rallyRanking<T extends RallyResult>(rows: T[], by: RallyCategory): T[] {
  const key = (r: T) => (by === 'fastest' ? r.minutes : r.fuelCentsPer100);
  return [...rows].sort((a, b) => key(a) - key(b) || a.finishedAt.getTime() - b.finishedAt.getTime());
}

/** Game minutes of the loaded leg of a schedule (loading to the end). */
export function loadedMinutes(segments: { leg: string; start: number; end: number }[]): number {
  const loaded = segments.filter((s) => s.leg === 'loaded');
  if (!loaded.length) return 0;
  return Math.round((Math.max(...loaded.map((s) => s.end)) - Math.min(...loaded.map((s) => s.start))) / 60_000);
}
