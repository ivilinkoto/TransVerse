/**
 * "Камион на месеца" (v1.8): each player enters one of their own trucks a
 * month (drawn as it is: paint, livery, parts); everyone has three votes,
 * not for themselves. After the month the top three with at least three
 * votes win ТрансКоин, the first one the badge and a place on the home page.
 */
export const TRUCK_CONTEST = { votes: 3, minVotes: 3, prizes: [100, 50, 25], badge: 'truck-of-month' } as const;

export interface TruckLook {
  modelId: string;
  trailerModelId: string | null;
  color: string;
  trailerColor?: string | null;
  livery: string | null;
  cosmetics: unknown;
  trailerUpgrades: string[];
  trailerLogo: string | null;
  trailerCosmetics: unknown;
}
