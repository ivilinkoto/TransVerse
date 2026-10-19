/**
 * A company hands a load from the board to a free player (who marked
 * themselves available): the player drives it with their own truck and pays
 * the company an agreed commission from the reward. Good for new drivers
 * (steady work) and for companies (capacity without trucks).
 */
export const HIRE_RULES = {
  minShare: 0.05,
  maxShare: 0.25,
  defaultShare: 0.1,
  /** The load is held for the driver this long. */
  offerMinutes: 15,
  /** Open offers a company may have at once. */
  maxPendingPerCompany: 5,
} as const;

export const commissionCents = (rewardCents: number, share: number) => Math.round(rewardCents * share);
