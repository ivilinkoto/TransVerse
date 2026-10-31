/**
 * 1.1.4.2 „Желанията на шофьорите“: now and then a hired driver asks for a
 * trip to a city by a date. Granted, the driver is more loyal and learns;
 * missed, loyalty drops. Game data.
 */
export const WISHES = {
  /** The chance a day that a driver without an open wish asks for one. */
  dailyChance: 0.12,
  days: 3,
  loyaltyKept: 10,
  loyaltyMissed: -12,
  xpKept: 1500,
  /** The city is a big one this far from the company's base at most (km). */
  maxKm: 700,
};

export const WISH_REASONS = [
  'рождения ден на дъщеря си',
  'сватбата на брат си',
  'мача на любимия си отбор',
  'родителите си',
  'годишнината от сватбата си',
  'стар приятел от казармата',
  'абитуриентския бал на сина си',
] as const;
