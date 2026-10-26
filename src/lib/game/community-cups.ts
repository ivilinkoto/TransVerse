/**
 * Community tournaments (v2.0), game money only: a player of level 10+
 * organises one — the measure (tonnes, deliveries, kilometres or loads on
 * time), optional cargo and country, the dates, the prize from their own
 * account and an optional entry fee that goes into the prize. Every load of
 * a player in it, delivered between the start and the end, counts. At the
 * end the prize goes 50 / 30 / 20 % to the first three. The organiser may
 * post a message, remove a player (their fee comes back) and, before the
 * start, cancel it (everything comes back).
 */
export const CUPS = {
  minLevel: 10,
  minPrizeCents: 1_000_00,
  maxPrizeCents: 500_000_00,
  maxFeeCents: 10_000_00,
  minHours: 24,
  maxDays: 14,
  maxAheadDays: 14,
  minPlayers: 2,
  maxPlayers: 200,
  maxOpenPerOrganizer: 3,
  split: [0.5, 0.3, 0.2] as const,
  nameMax: 50,
  textMax: 400,
} as const;

export const CUP_METRICS = ['tons', 'deliveries', 'km', 'ontime'] as const;
export type CupMetric = (typeof CUP_METRICS)[number];
export const CUP_METRIC_LABELS: Record<CupMetric, string> = { tons: 'Тонове', deliveries: 'Доставки', km: 'Километри с товар', ontime: 'Доставки навреме' };

/** What a load adds to a player's score. */
export function cupPoints(metric: CupMetric, load: { tons: number; km: number; late: boolean }): number {
  switch (metric) {
    case 'tons':
      return load.tons;
    case 'deliveries':
      return 1;
    case 'km':
      return load.km;
    case 'ontime':
      return load.late ? 0 : 1;
  }
}

/** The prizes of the first three from a pool (the rest of a split goes to the first when there are fewer players). */
export function cupPrizes(poolCents: number, players: number): number[] {
  const n = Math.min(players, CUPS.split.length);
  if (n <= 0) return [];
  const shares = CUPS.split.slice(0, n);
  const prizes = shares.map((s) => Math.floor(poolCents * s));
  prizes[0]! += poolCents - prizes.reduce((a, b) => a + b, 0);
  return prizes;
}
