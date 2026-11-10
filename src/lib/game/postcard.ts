/**
 * 1.2.3.6: the 3D postcard of a delivery — the player's own truck in 3D, made for the
 * first delivery to a city or for a long trip. Shown in the trip log, shared in the chat.
 */
export const POSTCARD = {
  longKm: 800,
  shareEveryHours: 2,
} as const;

export type PostcardReason = 'first_city' | 'long_trip';

export function postcardReason(firstCity: boolean, loadedKm: number): PostcardReason | null {
  if (firstCity) return 'first_city';
  return loadedKm >= POSTCARD.longKm ? 'long_trip' : null;
}

/** The scene of the postcard, by the month and the trip (snow in winter, a sunset after a long trip). */
export function postcardScene(reason: PostcardReason, completedAt: Date): 'snow' | 'sunset' | 'highway' {
  const m = completedAt.getUTCMonth();
  if (m === 11 || m <= 1) return 'snow';
  return reason === 'long_trip' ? 'sunset' : 'highway';
}
