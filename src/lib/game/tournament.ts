import { sofiaMidnight } from './missions';

/**
 * Пролетна купа (v1.6), game data: a knockout of up to 16 drivers over four
 * weeks. Each round is a week; in each pair the driver with more on-time
 * loaded kilometres that week goes on (a tie goes to the higher seed).
 * Sign-up runs from the release until the first round; seeds follow the
 * level. The champion, the finalist and the semi-finalists win ТрансКоин,
 * the champion also a badge.
 */
export const SPRING_CUP = {
  key: '2027-spring',
  title: 'Пролетна купа 2027',
  size: 16,
  minLevel: 3,
  signupFrom: sofiaMidnight(2027, 3, 20),
  /** Each round from Monday to Monday (Sofia). */
  rounds: [
    { title: 'Осминафинал', from: sofiaMidnight(2027, 3, 29), to: sofiaMidnight(2027, 4, 5) },
    { title: 'Четвъртфинал', from: sofiaMidnight(2027, 4, 5), to: sofiaMidnight(2027, 4, 12) },
    { title: 'Полуфинал', from: sofiaMidnight(2027, 4, 12), to: sofiaMidnight(2027, 4, 19) },
    { title: 'Финал', from: sofiaMidnight(2027, 4, 19), to: sofiaMidnight(2027, 4, 26) },
  ],
  /** Trips still on the road at the end of a round settle first. */
  graceMs: 6 * 3_600_000,
  prizes: { champion: 300, finalist: 150, semifinal: 75 },
  badge: 'spring-cup-2027',
} as const;

export const cupSignupOpen = (now: Date) => now >= SPRING_CUP.signupFrom && now < SPRING_CUP.rounds[0].from;

/** The seeds of the first round, pair by pair, so that 1 and 2 can meet only in the final. */
export function bracketSeeds(size: number): [number, number][] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2 + 1;
    order = order.flatMap((s) => [s, n - s]);
  }
  const pairs: [number, number][] = [];
  for (let i = 0; i < order.length; i += 2) pairs.push([order[i]!, order[i + 1]!]);
  return pairs;
}

/** Who goes on: more kilometres; a tie (or an empty week) goes to the higher seed. */
export function matchWinner(a: { id: string; seed: number; km: number } | null, b: { id: string; seed: number; km: number } | null) {
  if (!a || !b) return (a ?? b)?.id ?? null;
  if (a.km !== b.km) return a.km > b.km ? a.id : b.id;
  return a.seed < b.seed ? a.id : b.id;
}
