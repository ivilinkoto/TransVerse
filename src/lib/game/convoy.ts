/**
 * Convoy: a friend or a member of your company leaves on the same lane
 * (same origin and destination city) within half an hour of you. Each of
 * you gets a bonus on the reward when the load arrives on time.
 */
export const CONVOY_RULES = {
  windowMs: 30 * 60_000,
  bonusShare: 0.05,
} as const;
