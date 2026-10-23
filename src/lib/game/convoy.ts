/**
 * Convoy: a friend, a member of your company (or, from v1.5, of your alliance) leaves on the same lane
 * (same origin and destination city) within half an hour of you. Each of
 * you gets a bonus on the reward when the load arrives on time.
 */
export const CONVOY_RULES = {
  windowMs: 30 * 60_000,
  bonusShare: 0.05,
} as const;
