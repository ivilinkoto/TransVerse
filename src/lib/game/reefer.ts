/**
 * Хладилни товари с температура (v1.10): every refrigerated load has its
 * range (chilled, frozen, medicines, flowers). On the way the reefer unit
 * keeps it — the worse its condition, the longer the trip and the hotter
 * the season, the likelier it slips out of the range. On arrival: all in
 * range +3 %, a short slip −10 %, spoiled −40 %. Repairs keep the unit in
 * shape.
 */
export interface TempRange { min: number; max: number; label: string; strict: number }

export const REEFER_RANGES: { match: RegExp; range: TempRange }[] = [
  { match: /замразен|сладолед|риба/i, range: { min: -22, max: -18, label: 'замразено', strict: 1 } },
  { match: /лекарств|ваксин/i, range: { min: 2, max: 8, label: 'лекарства', strict: 1.6 } },
  { match: /цвет|лалет|нарцис/i, range: { min: 2, max: 6, label: 'цветя', strict: 1.2 } },
];
export const DEFAULT_RANGE: TempRange = { min: 0, max: 6, label: 'охладено', strict: 1 };

export const REEFER = {
  perfectShare: 0.03,
  slipShare: -0.1,
  spoiledShare: -0.4,
  readings: 12,
} as const;

export const rangeFor = (goods: string) => REEFER_RANGES.find((r) => r.match.test(goods))?.range ?? DEFAULT_RANGE;

export type ReeferOutcome = 'perfect' | 'slip' | 'spoiled';

/** The chance that the unit lets the load slip, from its condition, the trip and the season. */
export function slipChance(o: { condition: number; hours: number; summer: boolean; strict: number }) {
  const c = ((100 - Math.max(0, Math.min(100, o.condition))) / 100) * 0.7 + Math.min(0.25, o.hours * 0.012) + (o.summer ? 0.06 : 0);
  return Math.max(0.02, Math.min(0.9, c * o.strict));
}

/** The temperatures along the way and the outcome (`rand` decides). */
export function simulateReefer(range: TempRange, chance: number, rand: () => number) {
  const mid = (range.min + range.max) / 2;
  const half = (range.max - range.min) / 2;
  const slip = rand() < chance;
  const spoiled = slip && rand() < 0.35;
  const at = Math.floor(rand() * REEFER.readings);
  const readings = Array.from({ length: REEFER.readings }, (_, i) => {
    const base = mid + (rand() - 0.5) * half * 1.4;
    if (!slip || i < at || i > at + (spoiled ? 4 : 1)) return Math.round(base * 10) / 10;
    return Math.round((range.max + (spoiled ? 4 + rand() * 3 : 1 + rand() * 1.5)) * 10) / 10;
  });
  const outcome: ReeferOutcome = spoiled ? 'spoiled' : slip ? 'slip' : 'perfect';
  return { readings, outcome };
}

export const outcomeShare = (o: ReeferOutcome) => (o === 'perfect' ? REEFER.perfectShare : o === 'slip' ? REEFER.slipShare : REEFER.spoiledShare);
export const OUTCOME_LABELS: Record<ReeferOutcome, string> = { perfect: 'Температурата беше в норма през целия път', slip: 'Кратко излизане от нормата', spoiled: 'Стоката се развали' };
