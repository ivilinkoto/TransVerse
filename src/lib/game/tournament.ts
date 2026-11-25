/**
 * 1.3.2.4 „Турнир на седмицата“: weekly tournaments with an entry fee — the
 * weekly one for everyone and „Голямата купа“ with a bigger fee from a higher
 * level (a player may enter both). The score is the tons their trucks deliver
 * from the moment they enter until the week ends (Monday 00:00 Sofia). The
 * prize pool is `poolShare` of all the fees of that tournament, paid in
 * ТрансКоин to the first places by `split`; the rest stays with the game. With
 * fewer than `minPlayers` the fees are given back. Game data.
 */
export type TournamentTier = 'weekly' | 'grand';

export const TOURNAMENTS: Record<TournamentTier, { label: string; feeCoins: number; minLevel: number; emoji: string }> = {
  weekly: { label: 'Турнир на седмицата', feeCoins: 100, minLevel: 1, emoji: '🏆' },
  grand: { label: 'Голямата купа', feeCoins: 500, minLevel: 20, emoji: '👑' },
};
export const TOURNAMENT_TIERS = Object.keys(TOURNAMENTS) as TournamentTier[];

export const TOURNAMENT = { poolShare: 0.8, split: [0.5, 0.3, 0.2], minPlayers: 3 } as const;

/** The pool (whole coins) for this many players. */
export const tournamentPool = (players: number, tier: TournamentTier = 'weekly') => Math.floor(players * TOURNAMENTS[tier].feeCoins * TOURNAMENT.poolShare);

/** The prize of each paid place (whole coins; the first place gets what rounding leaves). */
export function tournamentPrizes(players: number, tier: TournamentTier = 'weekly'): number[] {
  if (players < TOURNAMENT.minPlayers) return [];
  const pool = tournamentPool(players, tier);
  const rest = TOURNAMENT.split.slice(1).map((s) => Math.floor(pool * s));
  return [pool - rest.reduce((a, b) => a + b, 0), ...rest];
}
