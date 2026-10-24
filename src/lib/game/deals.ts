import { hash } from './missions';

/**
 * Deals of v1.8 (game money only, no ТрансКоин — nothing to buy):
 * - Sealed cargo: the shipper does not say what is inside. The board shows
 *   the base pay; on arrival (on time) the load turns out ordinary, valuable
 *   (+50 %) or exceptional (+150 %).
 * - Haggling: on a big load the player may ask the shipper for more, once.
 *   The higher the ask, the likelier a "no" — and a "no" gives the load to
 *   someone else (it disappears for that player).
 * - The ghost of the record: on a lane with a record this month, the trip
 *   shows how far ahead or behind the record holder's run it is.
 */
export const SEALED = {
  share: 0.06,
  tiers: [
    { id: 'ordinary', label: 'обикновена пратка', bonus: 0, weight: 70 },
    { id: 'valuable', label: 'ценна пратка', bonus: 0.5, weight: 25 },
    { id: 'exceptional', label: 'изключителна пратка', bonus: 1.5, weight: 5 },
  ],
} as const;

/** What a sealed load turns out to be (deterministic by the load). */
export function sealedTier(contractId: string) {
  let roll = hash(`sealed:${contractId}`) % 100;
  for (const t of SEALED.tiers) {
    if (roll < t.weight) return t;
    roll -= t.weight;
  }
  return SEALED.tiers[0];
}

export const HAGGLE = {
  /** Only loads paying at least this much. */
  minRewardCents: 1_500_00,
  asks: [
    { percent: 10, chance: 0.8 },
    { percent: 20, chance: 0.5 },
    { percent: 30, chance: 0.25 },
  ],
  /** An agreed price holds this long. */
  holdMin: 15,
} as const;

export type HagglePercent = (typeof HAGGLE.asks)[number]['percent'];

/** Whether the shipper says yes (deterministic by load, player and ask: asking again changes nothing). */
export function haggleAccepted(contractId: string, userId: string, percent: number): boolean {
  const ask = HAGGLE.asks.find((a) => a.percent === percent);
  if (!ask) return false;
  return (hash(`haggle:${contractId}:${userId}`) % 1000) / 1000 < ask.chance;
}

/** The ghost: minutes the trip is ahead (+) or behind (−) the record run, from when the loaded leg starts. */
export function ghostLead(loadedStart: number, loadedEnd: number, recordMinutes: number) {
  return Math.round((loadedStart + recordMinutes * 60_000 - loadedEnd) / 60_000);
}
