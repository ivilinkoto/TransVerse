'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { api } from '@/lib/client/api';
import { crowKm, DAILY_ROUTE, type RouteCity } from '@/lib/game/daily-route';
import { playCoin, playSelect } from '@/lib/client/motion';
import { int } from '@/lib/format';
import { t } from '@/i18n/t';

interface View {
  day: string;
  cities: RouteCity[];
  tries: { order: number[]; km: number; pct: number }[];
  triesLeft: number;
  finished: boolean;
  best: { order: number[]; km: number } | null;
  top: { order: number[]; km: number; pct: number } | null;
  streak: number;
  share: string | null;
}

const W = 320;
const H = 220;
const PAD = 26;

/** Projects the cities into the small map (longitude squeezed by the latitude). */
function useProjection(cities: RouteCity[]) {
  return useMemo(() => {
    const mid = cities.reduce((s, c) => s + c.lat, 0) / cities.length;
    const k = Math.cos((mid * Math.PI) / 180);
    const xs = cities.map((c) => c.lon * k), ys = cities.map((c) => c.lat);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const s = Math.min((W - 2 * PAD) / Math.max(x1 - x0, 0.01), (H - 2 * PAD) / Math.max(y1 - y0, 0.01));
    const ox = (W - (x1 - x0) * s) / 2, oy = (H - (y1 - y0) * s) / 2;
    return new Map(cities.map((c) => [c.id, { x: ox + (c.lon * k - x0) * s, y: H - (oy + (c.lat - y0) * s) }]));
  }, [cities]);
}

/**
 * 1.3 „Пътят на деня“: tap the cities in order (the first is the start), check the
 * path, three tries. When the puzzle is over the best path shows on the map.
 */
export function DailyRoutePuzzle({ view }: { view: View }) {
  const router = useRouter();
  const start = view.cities[0]!;
  const [order, setOrder] = useState<number[]>([start.id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<{ km: number; pct: number; paidCents: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [, startTransition] = useTransition();
  const at = useProjection(view.cities);
  const by = new Map(view.cities.map((c) => [c.id, c]));
  const shown = view.finished ? (view.top?.order ?? order) : order;
  const km = shown.slice(1).reduce((s, id, i) => s + crowKm(by.get(shown[i]!)!, by.get(id)!), 0);
  const full = order.length === view.cities.length;

  const tap = (id: number) => {
    if (view.finished || busy) return;
    playSelect();
    setLast(null);
    if (order[order.length - 1] === id && id !== start.id) setOrder(order.slice(0, -1));
    else if (!order.includes(id)) setOrder([...order, id]);
  };
  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = (await api('/api/game/action', { type: 'dailyRouteGuess', order })) as { km: number; pct: number; paidCents: number };
      setLast(r);
      if (r.paidCents > 0) playCoin();
      setOrder([start.id]);
      startTransition(() => router.refresh());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const share = async () => {
    if (!view.share) return;
    try {
      await navigator.clipboard.writeText(view.share);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const line = (ids: number[]) => ids.map((id) => `${at.get(id)!.x},${at.get(id)!.y}`).join(' ');

  return (
    <section className="route-card rounded-3xl p-4 sm:p-5" data-testid="daily-route">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-glow">🧭 {view.day.split('-').reverse().join('.')}</p>
        <div className="flex gap-2 text-xs">
          <span className="route-chip rounded-full px-2.5 py-1">{t('Опити: {0}', view.triesLeft)}</span>
          {view.streak > 0 && <span className="route-chip rounded-full px-2.5 py-1" title={t('Дни поред с решен път')}>🔥 {t('Серия: {0}', view.streak)}</span>}
        </div>
      </div>

      <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <svg viewBox={`0 0 ${W} ${H}`} className="route-map w-full rounded-2xl" role="img" aria-label={t('Карта на градовете')}>
          {shown.length > 1 && <polyline points={line(shown)} fill="none" stroke="#22d3ee" strokeWidth={view.finished ? 2 : 3} strokeLinejoin="round" strokeLinecap="round" opacity={view.finished ? 0.45 : 1} />}
          {view.finished && view.best && <polyline points={line(view.best.order)} fill="none" stroke="#34d399" strokeWidth="3.5" strokeDasharray="7 5" strokeLinejoin="round" strokeLinecap="round" />}
          {view.cities.map((c) => {
            const p = at.get(c.id)!;
            const n = shown.indexOf(c.id);
            const isStart = c.id === start.id;
            return (
              <g key={c.id} onClick={() => tap(c.id)} className={view.finished ? '' : 'cursor-pointer'}>
                <circle cx={p.x} cy={p.y} r="15" fill="transparent" />
                <circle cx={p.x} cy={p.y} r={isStart ? 9 : 8} fill={n >= 0 ? (isStart ? '#f6c343' : '#22d3ee') : '#1e293b'} stroke={isStart ? '#fde68a' : '#94a3b8'} strokeWidth="2" />
                {n >= 0 && <text x={p.x} y={p.y + 3.5} textAnchor="middle" fontSize="10" fontWeight="800" fill="#0b1220">{n + 1}</text>}
              </g>
            );
          })}
        </svg>

        <div className="space-y-2">
          <ol className="grid grid-cols-2 gap-2">
            {view.cities.map((c) => {
              const n = shown.indexOf(c.id);
              const isStart = c.id === start.id;
              return (
                <li key={c.id}>
                  <button type="button" onClick={() => tap(c.id)} disabled={view.finished || isStart} className={`route-city flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm ${n >= 0 ? 'route-city-on' : ''} ${isStart ? 'route-city-start' : ''}`}>
                    <span className="route-num flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">{n >= 0 ? n + 1 : '·'}</span>
                    <span className="min-w-0 truncate font-semibold text-white">{c.name}</span>
                    <span className="ml-auto text-[10px] text-mist-400">{c.country}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="text-sm text-mist-300">
            {t('Път: {0} км по права линия', int(Math.round(km)))}
            {view.finished && view.best && <> · <span className="text-profit">{t('най-кратък (зелен): {0} км', int(view.best.km))}</span></>}
          </p>
          {!view.finished && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="game-action game-action-main flex-row px-5 py-2.5 text-sm" disabled={!full || busy} onClick={check} data-testid="daily-route-check">
                {busy ? t('Мерим…') : full ? t('Провери пътя') : t('Избери още {0}', view.cities.length - order.length)}
              </button>
              <button type="button" className="game-action flex-row px-4 py-2.5 text-sm" disabled={order.length < 2 || busy} onClick={() => setOrder([start.id])}>{t('Изчисти')}</button>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-loss">{error}</p>}
          {last && (
            <p role="status" className="fx-stamp text-sm font-bold text-white" data-testid="daily-route-result">
              {last.pct >= 100 ? t('Най-краткият път! {0} км', int(last.km)) : t('{0} км — {1}% от най-краткия', int(last.km), last.pct)}
              {last.paidCents > 0 && <span className="text-profit"> · +{int(last.paidCents / 100)} {t('лв.')}</span>}
            </p>
          )}
        </div>
      </div>

      {view.tries.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2 text-xs">
          {view.tries.map((x, i) => (
            <li key={i} className={`route-chip rounded-full px-2.5 py-1 ${x.pct >= 100 ? 'text-profit' : ''}`}>{t('Опит {0}: {1} км · {2}%', i + 1, int(x.km), x.pct)}</li>
          ))}
        </ul>
      )}
      {view.finished && view.share && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <pre className="route-share rounded-xl px-3 py-2 text-xs text-mist-100">{view.share}</pre>
          <button type="button" className="game-action game-action-gold flex-row px-4 py-2 text-sm" onClick={share} data-testid="daily-route-share">{copied ? t('Копирано ✓') : t('Сподели резултата')}</button>
          <span className="text-xs text-mist-400">{t('Нов път утре.')}</span>
        </div>
      )}
    </section>
  );
}
