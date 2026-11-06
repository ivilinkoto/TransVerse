/**
 * 1.2.7 „Заедно на пътя“: reasons for players to talk to each other — an escort for
 * oversize loads, a rating for partners, the café of the city, a wave on the road,
 * the convoy hour, „Търся / Давам“ for items, market rumours and the duo of the week.
 * The rewards are pass points, cases and titles, never ТрансКоин.
 */
export const ESCORT = {
  /** Oversize loads on the board that want an escort. */
  open: 3,
  /** The pilot truck leaves at most this long after the load (its run expires then). */
  windowMinutes: 15,
  /** Both on time: the load pays this much more, and the escort gets this share of the load. */
  mainBonus: 0.25,
  escortShare: 0.15,
  /** The escort run itself: a light load on the same road. */
  runTons: 1,
  runMultiplier: 1,
  passPoints: 400,
} as const;

export const RATING = {
  /** Ratings can be given this long after the load arrived. */
  hours: 72,
} as const;

export const CAFE = {
  perMinute: 4,
  /** Who is shown as „here“: trucks in the city now (idle) and in the last hours. */
  recentHours: 6,
} as const;

export const WAVE = {
  passPoints: 50,
  /** At most this many waves a day bring points. */
  perDay: 5,
} as const;

export const CONVOY_HOUR = {
  /** Sofia time, every day. */
  startHour: 20,
  minutes: 30,
  /** A convoy with a player of another company started in the hour: pass points ×2 for the trip. */
  multiplier: 2,
} as const;

/** Sofia hour/minute → is the convoy hour on. */
export function isConvoyHour(hour: number, minute: number): boolean {
  return hour === CONVOY_HOUR.startHour && minute < CONVOY_HOUR.minutes;
}

export const ITEM_WANTS = {
  max: 5,
} as const;

export const RUMORS = {
  /** Rumours a day (one true), told to this share of the players active in the last days. */
  perDay: 3,
  share: 0.35,
  /** A delivery of the true rumour's cargo to its country on its day: this share more. */
  bonusShare: 0.3,
  hour: 18,
} as const;

export const DUO = {
  /** Deliveries together (both counted) for the week's goal. */
  target: 20,
  passPoints: 1_000,
  case: 'case_silver' as const,
  /** Pairs are made on Monday from this Sofia hour, from the sign-ups of the week. */
  pairHour: 12,
} as const;
