/**
 * Drivers with a character (v1.4, game data): every hired driver has a
 * loyalty (0–100). It grows when the pay is fair and drops when it is low;
 * now and then a driver asks for a day off, a loyal-no-more one asks for a
 * raise, and one about to quit gets an offer from another company — then
 * only a raise keeps them.
 */

export const MOODS = {
  start: 70,
  /** Daily: + when paid at least the market rate, − when paid less than 90 % of it. */
  fairDaily: 1,
  lowDaily: 2,
  /** A day off now and then (chance per day, at most one a month). */
  vacationChance: 0.04,
  vacationEveryDays: 30,
  vacationHours: 24,
  /** Below these the driver asks for a raise / gets an offer from another company. */
  raiseBelow: 45,
  offerBelow: 20,
  raiseShare: 0.15,
  counterShare: 0.25,
  /** An answer waits this long (then the request is dropped; an offer means the driver leaves). */
  answerHours: 24,
} as const;

export type DriverRequest = 'raise' | 'vacation' | 'offer';

/** What a driver of this skill earns on the market, cents a day. */
export const marketSalaryCents = (skill: number) => (81 + skill * 20) * 100;

export const LOYALTY_LABELS: [number, string][] = [
  [80, 'Предан'],
  [60, 'Доволен'],
  [40, 'Колебае се'],
  [20, 'Недоволен'],
  [0, 'Мисли да напусне'],
];
export const loyaltyLabel = (l: number) => LOYALTY_LABELS.find(([min]) => l >= min)?.[1] ?? LOYALTY_LABELS.at(-1)![1];

export const REQUEST_TEXT: Record<DriverRequest, string> = {
  raise: 'иска повишение',
  vacation: 'иска почивен ден',
  offer: 'има оферта от друга компания',
};
