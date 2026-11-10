import type { ItemId } from './items';
import { sofiaDay } from './shop-v2';

/**
 * 1.3 „Зимен път“: „Зимен поход“ — seven steps, one more opening each day from the
 * release. The steps go in order; each one counts the trips the player drives
 * themselves while it is the current step. Every step pays, the last one also
 * gives the paint „Скреж“. Game data.
 */
export type TrekKind = 'deliveries' | 'km' | 'ontime' | 'reefer' | 'countries' | 'long' | 'heavy';

export interface TrekStep {
  kind: TrekKind;
  target: number;
  label: string;
  emoji: string;
  /** Money for the step, in cents. */
  cents: number;
  coins: number;
  item?: ItemId;
}

export const WINTER_TREK = {
  /** The first step opens with the release (12.11, 10:00 Sofia); one more each Sofia day. */
  from: '2026-11-12T10:00:00+02:00',
  /** Steps still count until the end of „Първи сняг“. */
  to: '2026-12-10T00:00:00+02:00',
  paintColor: '#bae6fd',
  steps: [
    { kind: 'deliveries', target: 2, label: 'Направи 2 доставки', emoji: '📦', cents: 1_500_00, coins: 0 },
    { kind: 'km', target: 600, label: 'Измини 600 км с товар', emoji: '🛣️', cents: 1_500_00, coins: 0 },
    { kind: 'ontime', target: 3, label: '3 доставки навреме', emoji: '⏱️', cents: 2_000_00, coins: 3 },
    { kind: 'reefer', target: 1, label: 'Достави хладилен товар', emoji: '🧊', cents: 2_000_00, coins: 0 },
    { kind: 'countries', target: 2, label: 'Достави в 2 различни държави', emoji: '🗺️', cents: 2_500_00, coins: 0 },
    { kind: 'long', target: 1, label: 'Курс над 800 км', emoji: '🏔️', cents: 3_000_00, coins: 5 },
    { kind: 'heavy', target: 50, label: 'Превози 50 тона', emoji: '🏋️', cents: 3_500_00, coins: 10, item: 'paint_frost' },
  ] satisfies TrekStep[],
} as const;

export const TREK_STEPS: readonly TrekStep[] = WINTER_TREK.steps;

/** Is the trek running (steps count) at this moment? */
export function trekOpen(now: Date): boolean {
  return now >= new Date(WINTER_TREK.from) && now < new Date(WINTER_TREK.to);
}

/** How many steps are open by this moment (0 before the start, all 7 from the seventh day). */
export function trekUnlocked(now: Date): number {
  const start = new Date(WINTER_TREK.from);
  if (now < start) return 0;
  const days = Math.round((Date.parse(`${sofiaDay(now)}T00:00:00Z`) - Date.parse(`${sofiaDay(start)}T00:00:00Z`)) / 86_400_000);
  return Math.min(TREK_STEPS.length, days + 1);
}

/** The Sofia day (YYYY-MM-DD) on which a step (0-based) opens. */
export function trekStepDay(step: number): string {
  const start = Date.parse(`${sofiaDay(new Date(WINTER_TREK.from))}T12:00:00Z`);
  return new Date(start + step * 86_400_000).toISOString().slice(0, 10);
}

/** What one delivery adds to the current step. */
export function trekIncrement(kind: TrekKind, f: { loadedKm: number; late: boolean; cargoType: string; destCountry: string; tons: number }, seen: string[]): number {
  switch (kind) {
    case 'deliveries':
      return 1;
    case 'km':
      return Math.round(f.loadedKm);
    case 'ontime':
      return f.late ? 0 : 1;
    case 'reefer':
      return f.cargoType === 'refrigerated' ? 1 : 0;
    case 'countries':
      return seen.includes(f.destCountry) ? 0 : 1;
    case 'long':
      return f.loadedKm >= 800 ? 1 : 0;
    case 'heavy':
      return Math.round(f.tons);
  }
}
