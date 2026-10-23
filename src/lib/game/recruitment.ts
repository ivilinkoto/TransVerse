/**
 * The recruitment board (v1.6): companies post that they are looking for
 * drivers, drivers without a company post that they are looking for one.
 * One post per company and per driver; a post lasts a week.
 */
export const RECRUITMENT_BOARD = {
  maxText: 280,
  days: 7,
  maxLevel: 100,
} as const;
