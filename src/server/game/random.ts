import { randomInt as cryptoInt } from 'node:crypto';

/** Server-side randomness (never exposed to clients). */
export const rand = (): number => cryptoInt(0, 1_000_000_000) / 1_000_000_000;
export const randInt = (min: number, maxInclusive: number): number => cryptoInt(min, maxInclusive + 1);
export const pick = <T>(items: readonly T[]): T => {
  if (!items.length) throw new Error('pick() from empty list');
  return items[randInt(0, items.length - 1)]!;
};
export function pickWeighted<T>(items: readonly T[], weight: (item: T) => number): T | undefined {
  const weights = items.map((i) => Math.max(0, weight(i)));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return undefined;
  let roll = rand() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i]!;
    if (roll < 0) return items[i];
  }
  return items.at(-1);
}
