/**
 * 1.3.2.1 „Честна монета“: a daily upkeep for an own fleet (garage, papers,
 * basic insurance), dearer per truck the bigger the fleet — free for the first
 * trucks, so it hits the big fleets, not the new players. Charged with the
 * payroll for the previous day, never below a zero balance. Game data.
 */
export const FLEET_UPKEEP = {
  /** The first day charged (YYYY-MM-DD, UTC like the payroll). */
  from: '2026-11-30',
  /** Each tier: the daily cost (lv.) of every own truck from `from` (1-based) on. */
  tiers: [
    { from: 1, lv: 0 },
    { from: 4, lv: 300 },
    { from: 11, lv: 700 },
    { from: 26, lv: 1_500 },
  ],
} as const;

/** The daily upkeep of `trucks` own trucks (cents). */
export function upkeepCents(trucks: number): number {
  let total = 0;
  for (let n = 1; n <= trucks; n++) {
    let lv = 0;
    for (const t of FLEET_UPKEEP.tiers) if (n >= t.from) lv = t.lv;
    total += lv * 100;
  }
  return total;
}
