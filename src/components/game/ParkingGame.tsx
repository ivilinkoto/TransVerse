'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client/api';
import { PARKING, parkingStart, step, type TruckPose } from '@/lib/game/parking';
import { t as tr } from '@/i18n/t';

const SCALE = 16; // px per metre in the drawing
const TICK_MS = 50;

/** A truck in the yard: the reference point is its rear; the cab points along the heading. */
function Truck({ p, color }: { p: TruckPose; color: string }) {
  const deg = (-p.heading * 180) / Math.PI;
  const { length: l, width: w } = PARKING.truck;
  return (
    <g transform={`translate(${p.x * SCALE} ${(PARKING.yard.h - p.y) * SCALE}) rotate(${deg})`}>
      <rect x={0} y={(-w / 2) * SCALE} width={(l - 1.8) * SCALE} height={w * SCALE} rx={3} fill="#e5e7eb" stroke="#0b1220" strokeWidth={1.5} />
      <rect x={(l - 1.7) * SCALE} y={(-w / 2) * SCALE} width={1.7 * SCALE} height={w * SCALE} rx={4} fill={color} stroke="#0b1220" strokeWidth={1.5} />
      <rect x={-2} y={(-w / 2 + 0.3) * SCALE} width={4} height={(w - 0.6) * SCALE} fill="#f87171" />
    </g>
  );
}

/** "Паркирай на рампата": steer while the truck reverses; the server replays the run and gives the stars. */
export function ParkingGame({ day, played }: { day: string; played: { stars: number } | null }) {
  const start = parkingStart(day);
  const [pose, setPose] = useState<TruckPose>(start);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ stars: number; xp?: number; note?: string } | null>(played ? { stars: played.stars } : null);
  const [error, setError] = useState<string | null>(null);
  const steer = useRef(0);
  const inputs = useRef<number[]>([]);
  const poseRef = useRef(start);

  const finish = useCallback(async () => {
    setRunning(false);
    try {
      const r = await api<{ stars: number; xp: number; crashed: boolean; dist: number }>('/api/game/action', { type: 'parking', inputs: inputs.current });
      setResult({ stars: r.stars, xp: r.xp, note: r.crashed ? tr('Излезе от двора.') : tr('{0} м от рампата.', r.dist) });
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      const next = step(poseRef.current, steer.current);
      inputs.current.push(steer.current);
      poseRef.current = next;
      setPose(next);
      const out = next.x < 0 || next.x > PARKING.yard.w || next.y < 0 || next.y > PARKING.yard.h;
      if (out || inputs.current.length >= PARKING.maxTicks) void finish();
    }, TICK_MS);
    return () => clearInterval(t);
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

  const { bay, yard } = PARKING;
  return (
    <div className="space-y-3">
      <svg viewBox={`0 0 ${yard.w * SCALE} ${yard.h * SCALE}`} className="w-full rounded-xl bg-[#3f4652]" role="img" aria-label={tr('Двор с рампа')}>
        {/* The ramp and its bay. */}
        <rect x={(bay.x - 1.8) * SCALE} y={(yard.h - bay.y) * SCALE} width={3.6 * SCALE} height={bay.y * SCALE} fill="#6b7280" />
        <rect x={(bay.x - 2.2) * SCALE} y={(yard.h - 1.2) * SCALE} width={4.4 * SCALE} height={1.2 * SCALE} fill="#f6c343" />
        <line x1={(bay.x - 1.8) * SCALE} y1={(yard.h - bay.y - 8) * SCALE} x2={(bay.x - 1.8) * SCALE} y2={(yard.h - bay.y) * SCALE} stroke="#f2f0e4" strokeWidth={3} strokeDasharray="10 8" />
        <line x1={(bay.x + 1.8) * SCALE} y1={(yard.h - bay.y - 8) * SCALE} x2={(bay.x + 1.8) * SCALE} y2={(yard.h - bay.y) * SCALE} stroke="#f2f0e4" strokeWidth={3} strokeDasharray="10 8" />
        <circle cx={bay.x * SCALE} cy={(yard.h - bay.y) * SCALE} r={5} fill="#22d3ee" />
        <Truck p={pose} color="#2f7bff" />
      </svg>
      {result ? (
        <p className="text-sm">{'⭐'.repeat(result.stars) || '—'} {result.xp ? tr('+{0} опит', result.xp) : ''} {result.note ?? ''} <span className="text-mist-400">{tr('Утре те чака нова рампа.')}</span></p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {!running ? <button type="button" className="btn-primary" onClick={() => setRunning(true)}>{tr('Тръгни назад')}</button> : <button type="button" className="btn-gold" onClick={() => void finish()}>{tr('Спри тук')}</button>}
          <button type="button" className="btn-ghost select-none px-5" disabled={!running} onPointerDown={() => { steer.current = -1; }} onPointerUp={() => { steer.current = 0; }} onPointerLeave={() => { steer.current = 0; }} aria-label={tr('Завий наляво')}>◀</button>
          <button type="button" className="btn-ghost select-none px-5" disabled={!running} onPointerDown={() => { steer.current = 1; }} onPointerUp={() => { steer.current = 0; }} onPointerLeave={() => { steer.current = 0; }} aria-label={tr('Завий надясно')}>▶</button>
          <span className="text-xs text-mist-400">{tr('Задръж бутоните (или стрелките ← →), за да завиваш.')}</span>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
    </div>
  );
}
