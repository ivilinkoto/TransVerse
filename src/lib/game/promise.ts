/**
 * 1.1.4.2 „Обещан срок“: when taking a load the player promises the client
 * how fast it arrives. „Бързо“ pays more when kept and costs pay and
 * reputation when broken; „Спокойно“ pays a little less but forgives half of
 * a late penalty. Game data.
 */
export const PROMISES = {
  fast: { label: 'Бързо', emoji: '⚡', hint: 'до 70% от срока: +15%', windowShare: 0.7, payShare: 0.15, brokenShare: -0.1, brokenReputation: -2 },
  normal: { label: 'Нормално', emoji: '🕒', hint: 'обичайният срок', windowShare: 1, payShare: 0, brokenShare: 0, brokenReputation: 0 },
  easy: { label: 'Спокойно', emoji: '🌿', hint: '−5%, половин неустойка', windowShare: 1, payShare: -0.05, brokenShare: 0, brokenReputation: 0 },
} as const;
export type PromiseId = keyof typeof PROMISES;
export const PROMISE_IDS = Object.keys(PROMISES) as PromiseId[];

/** The promised arrival time. */
export function promisedBy(promise: PromiseId, startedAt: number, deadlineAt: number): number {
  return startedAt + (deadlineAt - startedAt) * PROMISES[promise].windowShare;
}

/** What the promise brings on arrival: money (+/−), reputation and whether it was kept. */
export function promiseOutcome(promise: PromiseId, times: { startedAt: number; deadlineAt: number; completedAt: number }, rewardCents: number, penaltyCents: number) {
  const p = PROMISES[promise];
  const kept = times.completedAt <= promisedBy(promise, times.startedAt, times.deadlineAt);
  let cents = Math.round(rewardCents * (kept ? p.payShare : p.brokenShare));
  if (promise === 'easy') cents = Math.round(rewardCents * p.payShare) + Math.round(penaltyCents / 2);
  return { kept, cents, reputation: kept ? 0 : p.brokenReputation };
}
