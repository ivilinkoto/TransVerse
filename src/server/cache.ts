/**
 * 1.1.4: a tiny in-process cache for data that is the same for every player
 * and changes slowly (the newspaper, today's road weather) — the dashboard
 * reads them on every visit. Per server process; gone on restart.
 */
const store = new Map<string, { until: number; value: Promise<unknown> }>();

export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>, nowMs: number): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.until > nowMs) return hit.value as Promise<T>;
  const value = load();
  store.set(key, { until: nowMs + ttlMs, value });
  // A failed load is not kept.
  value.catch(() => store.delete(key));
  return value;
}
