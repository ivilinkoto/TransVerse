import { t } from '@/i18n/t';

/**
 * 1.2.3.6 „Рампата“: the big warehouses (cities from DOCK.minPopulation) unload
 * trucks in time slots, a few trucks per slot. A truck gets the slot of its
 * arrival; when that one is full it waits in the queue for the next free one.
 * A player in the queue may offer a gift to swap with an earlier truck. Game data.
 */
export const DOCK = {
  minPopulation: 400_000,
  /** Real minutes per slot. */
  slotMin: 15,
  /** Trucks per slot (the docks of a warehouse). */
  perSlot: 3,
  /** The queue never gets longer than this many slots. */
  maxQueueSlots: 12,
  giftMinCents: 50_00,
  giftMaxCents: 5_000_00,
  /** „Най-точен на рампата“: trucks straight to the dock and on time this week. */
  board: 10,
} as const;

const SLOT_MS = DOCK.slotMin * 60_000;
export const slotOf = (ms: number) => Math.floor(ms / SLOT_MS) * SLOT_MS;
export const hasDock = (population: number) => population >= DOCK.minPopulation;

/** The first slot from the arrival with a free dock, and the wait before it. */
export function bookSlot(arriveAt: number, taken: ReadonlyMap<number, number>): { slotAt: number; waitMs: number } {
  let slot = slotOf(arriveAt);
  for (let i = 0; i < DOCK.maxQueueSlots && (taken.get(slot) ?? 0) >= DOCK.perSlot; i++) slot += SLOT_MS;
  return { slotAt: slot, waitMs: Math.max(0, slot - arriveAt) };
}

/** The wait of a truck that arrives at `arriveAt` and holds `slotAt` (none when the slot has already begun). */
export const waitFor = (arriveAt: number, slotAt: number) => Math.max(0, slotAt - arriveAt);

type Seg = { kind: string; leg: string; start: number; end: number; stop?: number; note?: string };

/** The last unloading of the loaded leg (where the dock is). */
export const dockSegment = <T extends Seg>(segments: readonly T[]) => segments.findLastIndex((s) => s.kind === 'unloading' && s.leg === 'loaded' && !s.stop);

/**
 * Changes the queue before the last unloading from `oldWaitMs` to `newWaitMs`: the unloading
 * (the last segment) ends earlier or later and is marked „Опашка на рампата“ while there is a wait.
 */
export function withDockWait<T extends Seg>(segments: readonly T[], newWaitMs: number, oldWaitMs = 0): T[] {
  const i = dockSegment(segments);
  if (i < 0) return [...segments];
  const delta = newWaitMs - oldWaitMs;
  return segments.map((s, k) => {
    if (k < i) return s;
    const seg = { ...s, start: k === i ? s.start : s.start + delta, end: s.end + delta };
    if (k === i) {
      if (newWaitMs > 0) seg.note = t('Опашка на рампата');
      else if (s.note === t('Опашка на рампата')) delete seg.note;
    }
    return seg;
  });
}
