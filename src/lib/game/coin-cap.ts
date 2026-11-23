import { money } from '@/lib/format';
import { UNTAPERED_REASONS } from './coin-taper';
import { weekEndsAt, weekKey } from './leagues';

/**
 * 1.3.2.1 „Честна монета“: ТрансКоин earned in the game (rewards, cases, items
 * sold to the game…) are capped each week (Monday 00:00 Sofia). What goes over
 * the cap is paid in game money instead. What was bought, gifted, refunded,
 * given by the team or by a promo code never counts and is never capped.
 */
export const COIN_CAP = { weekly: 100, centsPerCoin: 200_00 } as const;

/**
 * 1.3.2.1: the only rewards still paid in ТрансКоин — the season pass, the
 * events' and the league's places, the team's giveaways and inviting a friend.
 * Every other reward is paid in game money (COIN_CAP.centsPerCoin per TC).
 */
export const TC_REWARDS: readonly string[] = ['season_pass', 'event_reward', 'league_reward', 'giveaway', 'referral_reward'];

/** A reward of this kind is paid in game money instead of ТрансКоин. */
export const paidInMoney = (reason: string) => capped(reason) && !TC_REWARDS.includes(reason);

/** What a TC reward of this kind is worth when it is paid in money (cents). */
export const moneyForCoins = (coins: number) => coins * COIN_CAP.centsPerCoin;

/** Reasons that count towards the weekly cap: every reward, and items sold to the game. */
export const capped = (reason: string) => reason === 'item_sale' || !UNTAPERED_REASONS.includes(reason);

/** Monday 00:00 (Sofia) of the week `now` is in. */
export const capWeekStart = (now: Date) => new Date(weekEndsAt(weekKey(now)).getTime() - 7 * 86_400_000);

/** How much of a reward fits under the cap, and what goes over it. */
export function splitByCap(amount: number, earnedThisWeek: number) {
  const room = Math.max(0, COIN_CAP.weekly - earnedThisWeek);
  const coins = Math.min(amount, room);
  return { coins, over: amount - coins };
}

/** How a TC reward paid in money reads in the game: „1 000 лв.“. */
export const coinsAsMoney = (coins: number) => money(moneyForCoins(coins));
