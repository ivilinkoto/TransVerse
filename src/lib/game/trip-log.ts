import type { Segment } from './schedule';

/**
 * Бордови дневник (v1.10): what a finished trip looked like — time at the
 * wheel, on breaks, at the borders, the average speed — and a card to share.
 */
export function tripStats(segments: Segment[], km: number) {
  const min = (kinds: Segment['kind'][]) => Math.round(segments.filter((s) => kinds.includes(s.kind)).reduce((sum, s) => sum + (s.end - s.start), 0) / 60_000);
  const drive = min(['drive']);
  const total = segments.length ? Math.round((segments[segments.length - 1]!.end - segments[0]!.start) / 60_000) : 0;
  return {
    totalMin: total,
    driveMin: drive,
    restMin: min(['break', 'rest']),
    borderMin: min(['border']),
    loadingMin: min(['loading', 'unloading']),
    stopsMin: min(['incident']),
    seaMin: min(['ferry', 'rail']),
    avgKmh: drive > 0 ? Math.round((km / drive) * 60) : 0,
    borders: segments.filter((s) => s.kind === 'border').length,
    breaks: segments.filter((s) => s.kind === 'break' || s.kind === 'rest').length,
  };
}
