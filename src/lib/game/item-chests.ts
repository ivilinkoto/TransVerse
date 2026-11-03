import type { ItemId } from './items';

/**
 * 1.2.1: the weekly chest (by the player's deliveries this week) and what a
 * company's chest gets for a finished project or a battle. Game data.
 */
export const WEEKLY_CHEST: { trips: number; item: ItemId }[] = [
  { trips: 5, item: 'case_bronze' },
  { trips: 15, item: 'case_silver' },
  { trips: 30, item: 'case_gold' },
];

export const CHEST_REWARDS = {
  project: { item: 'case_silver' as ItemId, qty: 2 },
  battleWin: { item: 'case_gold' as ItemId, qty: 1 },
  battleDraw: { item: 'case_silver' as ItemId, qty: 1 },
};
