'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { api } from '@/lib/client/api';
import { motionEnabled, playCoin, playSelect } from '@/lib/client/motion';
import { COURIER, courierDay, replayCourier } from '@/lib/game/courier';
import type { StreetGraph } from '@/lib/game/courier-graph';
import { t } from '@/i18n/t';

const LOADERS: Record<string, () => Promise<{ default: unknown }>> = {
  sofia: () => import('@/lib/game/streets/sofia.json'),
  plovdiv: () => import('@/lib/game/streets/plovdiv.json'),
  varna: () => import('@/lib/game/streets/varna.json'),
};

/** Road width (m on the map) and colour by kind: big streets wider and lighter. */
const KIND_STYLE = [
  { w: 16, c: '#94a3b8' }, { w: 14, c: '#94a3b8' }, { w: 12, c: '#7c8aa0' }, { w: 10, c: '#64748b' },
  { w: 7, c: '#475569' }, { w: 7, c: '#475569' }, { w: 5, c: '#3f4b5c' },
];

interface View { x: number; y: number; w: number; h: number }
type Phase = 'play' | 'sending' | 'done';
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * 1.4 „Градски куриер“: the real street map of the city centre (OpenStreetMap). Tap a junction
 * and the van drives there by the shortest way (it does not know the jams); deliver the 8
 * parcels before the time runs out. The same rules run on the server with the taps.
 */
export function CourierGame({ city, day, runsLeft }: { city: string; day: string; runsLeft: number }) {
  const router = useRouter();
  const [g, setG] = useState<StreetGraph | null>(null);
  useEffect(() => {
    let live = true;
    void LOADERS[city]!().then((m) => live && setG(m.default as StreetGraph));
    return () => { live = false; };
  }, [city]);
  if (!g) return <div className="grid h-[60vh] place-items-center text-sm text-mist-400">{t('Зареждам улиците…')}</div>;
  return <Board key={`${city}:${day}`} g={g} day={day} runsLeft={runsLeft} city={city} router={router} />;
}

function Board({ g, day, city, runsLeft, router }: { g: StreetGraph; day: string; city: string; runsLeft: number; router: ReturnType<typeof useRouter> }) {
  const job = useMemo(() => courierDay(g, day), [g, day]);
  // Flat projection in metres around the depot (a few km — good enough).
  const proj = useMemo(() => {
    const [lat0, lon0] = g.nodes[g.depot]!;
    const k = Math.cos((lat0 * Math.PI) / 180) * 111_320;
    return (lat: number, lon: number): [number, number] => [(lon - lon0) * k, (lat0 - lat) * 111_320];
  }, [g]);
  const pts = useMemo(() => g.nodes.map(([a, b]) => proj(a, b)), [g, proj]);
  const edgeLine = useMemo(() => g.edges.map(([a, b, , , , , inner]) => {
    const mid: [number, number][] = [];
    for (let i = 0; i < inner.length; i += 2) mid.push(proj(inner[i]!, inner[i + 1]!));
    return [pts[a]!, ...mid, pts[b]!];
  }), [g, pts, proj]);
  const d = (line: [number, number][]) => `M${line.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}`;
  const byKind = useMemo(() => KIND_STYLE.map((_, kind) => g.edges.map((e, i) => (e[3] === kind ? d(edgeLine[i]!) : '')).join('')), [g, edgeLine]);
  const jams = useMemo(() => [...job.jams].map((i) => d(edgeLine[i]!)).join(''), [job, edgeLine]);
  const parcelAt = useMemo(() => job.parcels.map((e) => { const l = edgeLine[e]!; return l[Math.floor(l.length / 2)]!; }), [job, edgeLine]);
  const bounds = useMemo(() => {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  }, [pts]);

  const [taps, setTaps] = useState<number[]>([]);
  const result = useMemo(() => replayCourier(g, job, taps), [g, job, taps]);
  const over = result.done || result.timeS >= COURIER.limitS;
  // How much of the driven path is drawn (it grows edge by edge after a tap).
  const [shown, setShown] = useState(0);
  const drawn = Math.min(shown, result.path.length);
  useEffect(() => {
    if (drawn >= result.path.length) return;
    const id = setTimeout(() => setShown(drawn + 1), motionEnabled() ? 70 : 0);
    return () => clearTimeout(id);
  }, [drawn, result.path.length]);
  const vanNode = drawn > 0 ? result.ends[drawn - 1]! : g.depot;
  const delivered = new Set(result.delivered.filter((e) => result.path.indexOf(e) < drawn));

  const [view, setView] = useState<View>(() => ({ x: -900, y: -900, w: 1800, h: 1800 }));
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean; view: View } | null>(null);
  const pinch = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStart = useRef<{ dist: number; view: View } | null>(null);

  const toMap = (cx: number, cy: number): [number, number] => {
    const r = svg.current!.getBoundingClientRect();
    const s = Math.max(view.w / r.width, view.h / r.height);
    const ox = view.x + (view.w - r.width * s) / 2, oy = view.y + (view.h - r.height * s) / 2;
    return [ox + (cx - r.left) * s, oy + (cy - r.top) * s];
  };
  const zoom = (f: number, cx?: number, cy?: number) => setView((v) => {
    const w = Math.min(Math.max(v.w * f, 300), Math.max(bounds.x1 - bounds.x0, bounds.y1 - bounds.y0) * 1.1);
    const k = w / v.w;
    const [mx, my] = cx !== undefined && cy !== undefined ? toMap(cx, cy) : [v.x + v.w / 2, v.y + v.h / 2];
    return { x: mx - (mx - v.x) * k, y: my - (my - v.y) * k, w, h: v.h * k };
  });

  const [phase, setPhase] = useState<Phase>('play');
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{ points: number; stars: number; xp: number; delivered: number } | null>(null);

  const tap = (cx: number, cy: number) => {
    if (phase !== 'play' || over || runsLeft <= 0) return;
    const [mx, my] = toMap(cx, cy);
    let best = -1, bd = Infinity;
    pts.forEach(([x, y], i) => { const dd = (x - mx) ** 2 + (y - my) ** 2; if (dd < bd) { bd = dd; best = i; } });
    const reach = (view.w / 18) ** 2;
    if (best < 0 || bd > reach || best === (result.ends.at(-1) ?? g.depot)) return;
    playSelect();
    setTaps((tp) => [...tp, best]);
  };

  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pinch.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current.size === 2) {
      const [a, b] = [...pinch.current.values()];
      pinchStart.current = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), view };
      drag.current = null;
      return;
    }
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, view };
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (pinch.current.has(e.pointerId)) pinch.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pinch.current.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const s = pinchStart.current;
      const k = Math.min(Math.max(s.dist / Math.max(dist, 1), 300 / s.view.w), 8000 / s.view.w);
      setView({ x: s.view.x + (s.view.w * (1 - k)) / 2, y: s.view.y + (s.view.h * (1 - k)) / 2, w: s.view.w * k, h: s.view.h * k });
      return;
    }
    const dr = drag.current;
    if (!dr || dr.id !== e.pointerId) return;
    const dx = e.clientX - dr.x, dy = e.clientY - dr.y;
    if (!dr.moved && Math.hypot(dx, dy) < 8) return;
    dr.moved = true;
    const r = svg.current!.getBoundingClientRect();
    const s = Math.max(dr.view.w / r.width, dr.view.h / r.height);
    setView({ ...dr.view, x: dr.view.x - dx * s, y: dr.view.y - dy * s });
  };
  const onUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const dr = drag.current;
    pinch.current.delete(e.pointerId);
    if (pinch.current.size < 2) pinchStart.current = null;
    if (dr && dr.id === e.pointerId && !dr.moved) tap(e.clientX, e.clientY);
    if (dr?.id === e.pointerId) drag.current = null;
  };
  const onWheel = (e: ReactWheelEvent<SVGSVGElement>) => zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);

  const send = () => {
    if (!taps.length) return;
    setPhase('sending');
    api('/api/game/action', { type: 'courierRun', city, taps })
      .then((r) => {
        const res = r as unknown as { points: number; stars: number; xp: number; delivered: number };
        setAnswer(res);
        if (res.xp > 0) playCoin();
        setPhase('done');
        router.refresh();
      })
      .catch((err: Error) => { setError(err.message); setPhase('done'); });
  };

  const [vx, vy] = pts[vanNode]!;
  const scale = view.w / 900; // marker size follows the zoom so they stay readable
  const driven = d(result.path.slice(0, drawn).flatMap((e, i) => {
    const line = edgeLine[e]!;
    const from = i === 0 ? g.depot : result.ends[i - 1]!;
    return g.edges[e]![0] === from ? line : [...line].reverse();
  }));
  const left = job.parcels.filter((e) => !delivered.has(e));

  return (
    <div className="space-y-3" data-testid="courier-game">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-lg bg-asphalt-800 px-2.5 py-1 font-semibold num" data-testid="courier-clock">⏱ {mmss(Math.min(result.timeS, COURIER.limitS))} / {mmss(COURIER.limitS)}</span>
        <span className="rounded-lg bg-asphalt-800 px-2.5 py-1 font-semibold">📦 {delivered.size} / {job.parcels.length}</span>
        <span className="text-xs text-mist-400">{t('Смени днес: {0}', runsLeft)}</span>
        <span className="ml-auto flex gap-1">
          <button type="button" className="game-action flex-row px-3 py-1.5 text-sm" onClick={() => zoom(1 / 1.4)} aria-label={t('Приближи')}>＋</button>
          <button type="button" className="game-action flex-row px-3 py-1.5 text-sm" onClick={() => zoom(1.4)} aria-label={t('Отдалечи')}>－</button>
        </span>
      </div>
      <div className="relative overflow-hidden rounded-2xl border border-asphalt-700 bg-[#0b1220]">
        <svg ref={svg} viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} className="h-[62vh] w-full touch-none select-none" preserveAspectRatio="xMidYMid meet"
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel} role="img" aria-label={t('Карта на центъра')}>
          {byKind.map((path, kind) => path && <path key={kind} d={path} stroke={KIND_STYLE[kind]!.c} strokeWidth={KIND_STYLE[kind]!.w} fill="none" strokeLinecap="round" strokeLinejoin="round" />)}
          <path d={jams} stroke="#ef4444" strokeOpacity={0.85} strokeWidth={9} fill="none" strokeLinecap="round" strokeDasharray="18 10" />
          <path d={driven} stroke="#22d3ee" strokeOpacity={0.9} strokeWidth={7} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          {job.parcels.map((e, i) => {
            const [x, y] = parcelAt[i]!;
            const ok = delivered.has(e);
            return (
              <g key={e} transform={`translate(${x} ${y}) scale(${scale})`}>
                <circle r={13} fill={ok ? '#16a34a' : '#f59e0b'} stroke="#0b1220" strokeWidth={3} />
                <text y={5} textAnchor="middle" fontSize={14} fontWeight={800} fill="#0b1220">{ok ? '✓' : i + 1}</text>
              </g>
            );
          })}
          <g transform={`translate(${pts[g.depot]![0]} ${pts[g.depot]![1]}) scale(${scale})`}><rect x={-11} y={-11} width={22} height={22} rx={5} fill="#a78bfa" stroke="#0b1220" strokeWidth={3} /><text y={5} textAnchor="middle" fontSize={13} fontWeight={800} fill="#0b1220">D</text></g>
          <g transform={`translate(${vx} ${vy}) scale(${scale})`}><circle r={15} fill="#22d3ee" stroke="#ecfeff" strokeWidth={3} /><text y={6} textAnchor="middle" fontSize={16}>🚐</text></g>
        </svg>
        <p className="pointer-events-none absolute bottom-1 right-2 text-[10px] text-mist-500">© <a className="pointer-events-auto underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> {t('сътрудници')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="game-action flex-row px-4 py-2 text-sm" disabled={!taps.length || phase !== 'play'} onClick={() => setTaps((tp) => tp.slice(0, -1))}>{t('↶ Назад')}</button>
        <button type="button" className="game-action game-action-gold flex-row px-5 py-2 text-sm" disabled={!taps.length || phase !== 'play' || runsLeft <= 0} onClick={send} data-testid="courier-send">{over ? t('Предай смяната') : t('Приключи смяната')}</button>
      </div>
      {phase === 'done' && (answer ? (
        <div className="rounded-2xl border border-gold-400/50 bg-gold-400/10 p-4 text-sm" data-testid="courier-result">
          <p className="font-display text-lg font-bold text-gold-300">{'★'.repeat(answer.stars)}{'☆'.repeat(3 - answer.stars)} · {t('{0} точки', answer.points)}</p>
          <p className="text-mist-300">{t('Доставени: {0} от {1}.', answer.delivered, job.parcels.length)} {answer.xp > 0 ? t('+{0} опит.', answer.xp) : ''}</p>
        </div>
      ) : error && <p className="text-sm text-red-300">{error}</p>)}
      <ul className="grid gap-1 text-xs text-mist-300 sm:grid-cols-2" data-testid="courier-parcels">
        {job.parcels.map((e, i) => (
          <li key={e} className={delivered.has(e) ? 'text-emerald-300 line-through' : ''}>{i + 1}. {g.names[g.edges[e]![5]] ?? t('Без име')}</li>
        ))}
      </ul>
      {left.length > 0 && over && phase === 'play' && <p className="text-xs text-amber-300">{t('Времето свърши — предай смяната.')}</p>}
    </div>
  );
}
