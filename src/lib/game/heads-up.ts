/** 1.1.2: "пристига след ~5 мин" and the player's weekly report. */
export const HEADS_UP = {
  /** The heads-up comes this many minutes before the truck arrives… */
  soonMinutes: 5,
  /** …only for trips at least this long (short ones would just add noise). */
  soonMinTripMinutes: 20,
  /** The weekly report covers this many days, sent on Monday morning (Sofia). */
  weekDays: 7,
} as const;
