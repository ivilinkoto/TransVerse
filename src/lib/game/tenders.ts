/**
 * Company tenders: one big order split into many loads that the members drive
 * together. Pure sizing rules shared by server and UI.
 *
 * Each load pays its driver like a normal job. When every load arrives before
 * the deadline the treasury gets the bonus (and the deposit back) plus company
 * XP; otherwise the deposit is lost.
 */

/** Offers on the company's board at a time, and tenders it may run at once. */
export const TENDER_OFFERS = 3;
export const MAX_ACTIVE_TENDERS = 2;
export const OFFER_HOURS = 24;

/** Bonus to the treasury as a share of what all loads pay their drivers; deposit as a share of the bonus. */
export const BONUS_SHARE = 0.5;
export const DEPOSIT_SHARE = 0.2;
export const XP_PER_LOAD = 120;

/** How many loads a company of this size can take on. */
export function tenderLoads(members: number, companyLevel: number, roll: number): number {
  const base = Math.round(members * 1.5 + companyLevel + roll * 4);
  return Math.max(3, Math.min(25, base));
}

/**
 * Time to deliver everything: a round trip per load, shared by the members
 * (assuming about two thirds of them drive), with a comfortable margin.
 */
export function tenderHours(loads: number, oneWayMinutes: number, members: number): number {
  const roundTripHours = (oneWayMinutes * 2) / 60;
  const drivers = Math.max(1, Math.round(members * 0.66));
  return Math.max(12, Math.min(96, Math.ceil(((loads * roundTripHours) / drivers) * 2.2 + 4)));
}

const round100 = (cents: number) => Math.round(cents / 100_00) * 100_00;

export function tenderMoney(loads: number, rewardPerLoadCents: number) {
  const bonusCents = Math.max(1_000_00, round100(loads * rewardPerLoadCents * BONUS_SHARE));
  return { bonusCents, depositCents: Math.max(500_00, round100(bonusCents * DEPOSIT_SHARE)), xp: loads * XP_PER_LOAD };
}

/** Kinds of offers: small loads any truck can carry, and full truck loads. */
export const TENDER_KINDS = [
  { cargo: 'pallets', loadTons: 6, label: 'Палетизирани пратки' },
  { cargo: 'pallets', loadTons: 20, label: 'Цели камиони палети' },
  { cargo: 'bulk', loadTons: 22, label: 'Насипен товар' },
  { cargo: 'container', loadTons: 20, label: 'Контейнери' },
  { cargo: 'refrigerated', loadTons: 6, label: 'Хладилни пратки' },
] as const;
