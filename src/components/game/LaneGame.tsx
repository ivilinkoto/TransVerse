'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client/api';
import { LANE, laneCentre } from '@/lib/game/lane';
import { t as tr } from '@/i18n/t';

const TICK_MS = 60;
const VIEW = 40; // ticks of road shown ahead
const PX = 28; // px per metre across

/** "Лентата": keep the truck in its lane as the road bends; the server replays the run. */
export function LaneGame({ deliveryId, played }: { deliveryId: string; played: boolean }) {
  const [tick, setTick] = useState(0);
  const [x, setX] = useState(() => laneCentre(deliveryId, 0));
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ stars: number; xp: number; share: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const steer = useRef(0);
  const inputs = useRef<number[]>([]);
  const xRef = useRef(x);

  const finish = useCallback(async () => {
    setRunning(false);
    try {
      setResult(await api<{ stars: number; xp: number; share: number }>('/api/game/action', { type: 'lane', deliveryId, inputs: inputs.current }));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [deliveryId]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      inputs.current.push(steer.current);
      xRef.current += steer.current * LANE.steer;
      setX(xRef.current);
      setTick(inputs.current.length);
      if (inputs.current.length >= LANE.ticks) void finish();
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [running, finish]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') steer.current = -1;
      if (e.key === 'ArrowRight') steer.current = 1;
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') steer.current = 0;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  if (played && !result) return <p className="text-sm text-mist-400">{tr('Този курс вече има резултат в Лентата.')}</p>;
  const w = 320;
  const h = 200;
  // The road ahead: row i (bottom = now) is the lane centre i ticks ahead.
  const rows = Array.from({ length: VIEW }, (_, i) => ({ y: h - (i * h) / VIEW, c: laneCentre(deliveryId, tick + i) }));
  const sx = (m: number) => w / 2 + (m - x) * PX;
  const left = rows.map((r) => `${sx(r.c - LANE.halfWidth - 1.2)},${r.y}`).join(' ');
  const right = rows.map((r) => `${sx(r.c + LANE.halfWidth + 1.2)},${r.y}`).reverse().join(' ');
  const inLane = Math.abs(x - laneCentre(deliveryId, tick)) <= LANE.halfWidth;
  return (
    <div className="space-y-3">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-md rounded-xl bg-[#2f6b3a]" role="img" aria-label={tr('Път с лента')}>
        <polygon points={`${left} ${right}`} fill="#3f4652" />
        <polyline points={rows.map((r) => `${sx(r.c)},${r.y}`).join(' ')} fill="none" stroke="#f2f0e4" strokeWidth={2} strokeDasharray="8 8" />
        <rect x={w / 2 - 9} y={h - 34} width={18} height={30} rx={3} fill={inLane ? '#2f7bff' : '#f87171'} stroke="#0b1220" />
      </svg>
      {result ? (
        <p className="text-sm">{'⭐'.repeat(result.stars) || '—'} {tr('{0} % в лентата', result.share)} {result.xp ? tr('+{0} опит', result.xp) : ''}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {!running ? <button type="button" className="btn-primary" onClick={() => setRunning(true)}>{tr('Карай')}</button> : <span className="num text-sm text-mist-300">{Math.round((tick / LANE.ticks) * 100)} %</span>}
          <button type="button" className="btn-ghost select-none px-5" disabled={!running} onPointerDown={() => { steer.current = -1; }} onPointerUp={() => { steer.current = 0; }} onPointerLeave={() => { steer.current = 0; }} aria-label={tr('Наляво')}>◀</button>
          <button type="button" className="btn-ghost select-none px-5" disabled={!running} onPointerDown={() => { steer.current = 1; }} onPointerUp={() => { steer.current = 0; }} onPointerLeave={() => { steer.current = 0; }} aria-label={tr('Надясно')}>▶</button>
          <span className="text-xs text-mist-400">{tr('Дръж камиона в лентата — бутоните или стрелките ← →.')}</span>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
    </div>
  );
}
