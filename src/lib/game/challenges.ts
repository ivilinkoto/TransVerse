import { EUROPE_COUNTRIES, LAUNCH_COUNTRIES } from '@/lib/geo/scope';

/**
 * Challenges of v1.6 (game data):
 * - Евротур: deliveries to all nine countries of the game in one calendar
 *   month (Sofia) earn a badge and ТрансКоин, once a month.
 * - The big convoy: up to five trucks drive one lane together; from three
 *   trucks on, everyone on time gets an extra bonus and the first truck's
 *   driver the badge "Водач на колона".
 * - The challenge of the week: one measure each week (rotating), a weekly
 *   ranking of all players and ТрансКоин for the top three. Unlike the rally
 *   (one fixed route), every trip of the week counts.
 */
export const EUROTOUR = {
  countries: LAUNCH_COUNTRIES as readonly string[],
  coins: 100,
  badge: 'eurotour',
} as const;

/** v1.7: Голям евротур — deliveries to all the countries of 1.7 within one season (v2.0 keeps it to those 26). */
export const GRAND_EUROTOUR = {
  countries: [...LAUNCH_COUNTRIES, ...EUROPE_COUNTRIES] as readonly string[],
  coins: 300,
  badge: 'grand-eurotour',
} as const;

export const BIG_CONVOY = {
  maxTrucks: 5,
  minTrucks: 3,
  /** Extra share of the reward for each truck on time, by the size of the convoy. */
  bonusShare: { 3: 0.03, 4: 0.05, 5: 0.07 } as Record<number, number>,
  badge: 'convoy-leader',
} as const;

export const bigConvoyShare = (size: number) => (size < BIG_CONVOY.minTrucks ? 0 : (BIG_CONVOY.bonusShare[Math.min(size, BIG_CONVOY.maxTrucks)] ?? 0));

export type ChallengeMetric = 'ontime' | 'km' | 'tons' | 'countries' | 'lanes';

export const CHALLENGE_METRICS: Record<ChallengeMetric, { title: string; unit: string; description: string }> = {
  ontime: { title: 'Точен като часовник', unit: 'курса', description: 'Най-много курсове навреме за седмицата.' },
  km: { title: 'Дълъг път', unit: 'км', description: 'Най-много километри с товар (курсове навреме).' },
  tons: { title: 'Тежка категория', unit: 'т', description: 'Най-много превозени тонове (курсове навреме).' },
  countries: { title: 'Без граници', unit: 'държави', description: 'Доставки до най-много различни държави.' },
  lanes: { title: 'Нови пътища', unit: 'линии', description: 'Най-много различни линии (от град до град).' },
};

export const WEEKLY_CHALLENGE = {
  rotation: ['ontime', 'km', 'countries', 'tons', 'lanes'] as ChallengeMetric[],
  prizes: [60, 40, 20],
  /** Trips still on the road at the end of the week settle first. */
  graceMs: 6 * 3_600_000,
} as const;

/** The measure of a week by its key (`W2027-11`): the same for everyone. */
export function challengeMetric(weekKey: string): ChallengeMetric {
  const [, y = '0', w = '0'] = /^W(\d+)-(\d+)$/.exec(weekKey) ?? [];
  const r = WEEKLY_CHALLENGE.rotation;
  return r[(Number(y) * 53 + Number(w)) % r.length]!;
}
