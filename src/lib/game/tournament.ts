/**
 * 1.3.2.4 „Турнир на седмицата“: a weekly tournament with an entry fee. A player
 * pays `feeCoins` ТрансКоин to enter; the score is the tons their trucks deliver
 * from the moment they enter until the week ends (Monday 00:00 Sofia). The
 * prize pool is `poolShare` of all the fees, paid in ТрансКоин to the first
 * places by `split`; the rest stays with the game. With fewer than `minPlayers`
 * the fees are given back. Game data.
 */
export const TOURNAMENT = { feeCoins: 100, poolShare: 0.8, split: [0.5, 0.3, 0.2], minPlayers: 3 } as const;

/** The pool (whole coins) for this many players. */
export const tournamentPool = (players: number) => Math.floor(players * TOURNAMENT.feeCoins * TOURNAMENT.poolShare);

/** The prize of each paid place (whole coins; the first place gets what rounding leaves). */
export function tournamentPrizes(players: number): number[] {
  if (players < TOURNAMENT.minPlayers) return [];
  const pool = tournamentPool(players);
  const rest = TOURNAMENT.split.slice(1).map((s) => Math.floor(pool * s));
  return [pool - rest.reduce((a, b) => a + b, 0), ...rest];
}
