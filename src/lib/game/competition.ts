/**
 * Competition in v1.5 (game data):
 * - Divisions of the companies (bronze, silver, gold): a monthly table by the
 *   tonnes of the members; the best go up, the last go down.
 * - The perfect trip: on time, no breakdown or police stop, no fine and a
 *   full truck — a streak of them adds to the pay and earns badges.
 * - The city album: a card for every big city a player delivers to; a full
 *   country page earns ТрансКоин and a badge.
 */
export const DIVISIONS = ['bronze', 'silver', 'gold'] as const;
export type Division = (typeof DIVISIONS)[number];

export const DIVISION_LABELS: Record<Division, string> = { bronze: 'Бронзова', silver: 'Сребърна', gold: 'Златна' };

export const DIVISION_RULES = {
  /** Share of a division that moves up / down each month (at least one when there are enough companies). */
  moveShare: 0.2,
  minCompanies: 3,
  /** Prizes for the top three of each division, into the treasury. */
  prizes: { bronze: [5_000_00, 3_000_00, 2_000_00], silver: [10_000_00, 6_000_00, 4_000_00], gold: [20_000_00, 12_000_00, 8_000_00] } as Record<Division, number[]>,
} as const;

/** Where each company of a division table goes: up, down or stays (the table is sorted best first). */
export function divisionMoves(division: Division, size: number): ('up' | 'down' | 'stay')[] {
  const n = size >= DIVISION_RULES.minCompanies ? Math.max(1, Math.floor(size * DIVISION_RULES.moveShare)) : 0;
  return Array.from({ length: size }, (_, i) => {
    if (i < n && division !== 'gold') return 'up';
    if (i >= size - n && division !== 'bronze') return 'down';
    return 'stay';
  });
}

export const nextDivision = (d: Division, move: 'up' | 'down' | 'stay'): Division => {
  const i = DIVISIONS.indexOf(d) + (move === 'up' ? 1 : move === 'down' ? -1 : 0);
  return DIVISIONS[Math.max(0, Math.min(DIVISIONS.length - 1, i))]!;
};

export const PERFECT = {
  /** The load must fill at least this share of the truck. */
  minFill: 0.9,
  /** +1 % of the freight per perfect trip in a row, up to +10 %. */
  bonusPerStep: 0.01,
  maxBonus: 0.1,
  badges: [[5, 'perfect-5'], [10, 'perfect-10'], [25, 'perfect-25']] as [number, string][],
  /** Road events that spoil a perfect trip. */
  spoilers: ['breakdown', 'police'],
} as const;

/** A Discord role while the streak is at least this long. */
export const PERFECT_ROLE_STREAK = 10;

export const perfectBonusShare = (streak: number) => Math.min(PERFECT.maxBonus, streak * PERFECT.bonusPerStep);

export function isPerfectTrip(f: { late: boolean; violations: readonly string[]; events: readonly { kind: string }[]; tons: number; payloadTons: number }): boolean {
  return !f.late && f.violations.length === 0 && !f.events.some((e) => (PERFECT.spoilers as readonly string[]).includes(e.kind)) && f.payloadTons > 0 && f.tons >= f.payloadTons * PERFECT.minFill;
}

export const ALBUM = {
  /** The biggest market cities of a country make its album page. */
  citiesPerCountry: 20,
  /** A full page. */
  coins: 50,
} as const;

export const albumBadge = (country: string) => `album-${country.toLowerCase()}`;
