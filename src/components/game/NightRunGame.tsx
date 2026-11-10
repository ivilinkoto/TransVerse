'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/client/api';
import { motionEnabled, playCoin, playSelect } from '@/lib/client/motion';
import { carY, NIGHT_RUN, nightRoad, speedAt, startRun, stepRun, type RunState } from '@/lib/game/night-run';
import { int } from '@/lib/format';
import { t } from '@/i18n/t';

const CAR_COLOURS = ['#ef4444', '#3b82f6', '#eab308', '#a855f7', '#f97316', '#e5e7eb'];
const LANE_W = 3.6;
/** Metres shown behind and ahead of the truck. */
const BEHIND = 14;
const AHEAD = 70;

type Phase = 'ready' | 'count' | 'run' | 'sending' | 'done';

/**
 * 1.3 „Нощен рейс“: the day's night road on a canvas. ←/→ (A/D), the on-screen
 * buttons or a swipe change lanes; the same rules as the server run at 30 ticks a
 * second, and the inputs go to the server, which replays them and decides.
 */
export function NightRunGame({ day, colour, runsLeft }: { day: string; colour: string; runsLeft: number }) {
  const router = useRouter();
  const canvas = useRef<HTMLCanvasElement>(null);
  const road = useMemo(() => nightRoad(day), [day]);
  const state = useRef<RunState>(startRun());
  const inputs = useRef<number[]>([]);
  const pending = useRef(0);
  const [phase, setPhase] = useState<Phase>('ready');
  const [count, setCount] = useState(3);
  const [hud, setHud] = useState({ metres: 0, fuel: 100, crashes: 0, left: NIGHT_RUN.maxTicks, kmh: NIGHT_RUN.speed[0] * 3.6 });
  const [result, setResult] = useState<{ metres: number; stars: number; xp: number; crashes: number; over: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const steer = useCallback((dir: number) => {
    pending.current = dir;
  }, []);

  // Keys.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (phase !== 'run') return;
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') (steer(-1), e.preventDefault());
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') (steer(1), e.preventDefault());
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [phase, steer]);

  const draw = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const W = c.width, H = c.height;
    const s = state.current;
    const roadW = LANE_W * NIGHT_RUN.lanes;
    const k = (W * 0.78) / roadW;
    const left = (W - roadW * k) / 2;
    const yToPx = (y: number) => H - ((y - (s.y - BEHIND)) / (AHEAD + BEHIND)) * H;
    const laneX = (lane: number) => left + (lane + 0.5) * LANE_W * k;
    // Night, the shoulders and the asphalt.
    ctx.fillStyle = '#05080f';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#0d1424';
    ctx.fillRect(left - 10, 0, roadW * k + 20, H);
    ctx.fillStyle = '#151c2b';
    ctx.fillRect(left, 0, roadW * k, H);
    // Edge lines and the dashed lane lines (scrolling with the distance).
    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(left - 2, 0, 3, H);
    ctx.fillRect(left + roadW * k - 1, 0, 3, H);
    ctx.fillStyle = 'rgba(229,231,235,0.7)';
    const dash = 6, gap = 9;
    const start = Math.floor((s.y - BEHIND) / (dash + gap)) * (dash + gap);
    for (let lane = 1; lane < NIGHT_RUN.lanes; lane++) {
      const x = left + lane * LANE_W * k - 1.5;
      for (let y = start; y < s.y + AHEAD; y += dash + gap) ctx.fillRect(x, yToPx(y + dash), 3, dash * (H / (AHEAD + BEHIND)));
    }
    // Reflector posts every 25 m.
    ctx.fillStyle = '#f59e0b';
    for (let y = Math.floor((s.y - BEHIND) / 25) * 25; y < s.y + AHEAD; y += 25) {
      ctx.fillRect(left - 8, yToPx(y), 3, 5);
      ctx.fillRect(left + roadW * k + 5, yToPx(y), 3, 5);
    }
    const carW = LANE_W * k * 0.55, carL = 4.6 * (H / (AHEAD + BEHIND));
    // Fuel cans.
    road.cans.forEach((can, i) => {
      if (s.takenCans.has(i) || can.y < s.y - BEHIND || can.y > s.y + AHEAD) return;
      const x = laneX(can.lane), y = yToPx(can.y);
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(x - 7, y - 9, 14, 18);
      ctx.fillStyle = '#fca5a5';
      ctx.fillRect(x - 3, y - 13, 6, 4);
    });
    // Traffic: tail lights towards the truck.
    road.cars.forEach((car, i) => {
      const cy = carY(car, s.tick);
      if (cy < s.y - BEHIND || cy > s.y + AHEAD) return;
      const x = laneX(car.lane), y = yToPx(cy);
      ctx.globalAlpha = s.hitCars.has(i) ? 0.35 : 1;
      ctx.fillStyle = CAR_COLOURS[car.colour % CAR_COLOURS.length]!;
      ctx.fillRect(x - carW / 2, y - carL / 2, carW, carL);
      ctx.fillStyle = 'rgba(15,23,42,0.75)';
      ctx.fillRect(x - carW / 2 + 3, y - carL / 2 + carL * 0.22, carW - 6, carL * 0.2);
      ctx.fillStyle = '#f43f5e';
      ctx.fillRect(x - carW / 2 + 2, y + carL / 2 - 4, 6, 3);
      ctx.fillRect(x + carW / 2 - 8, y + carL / 2 - 4, 6, 3);
      ctx.globalAlpha = 1;
    });
    // The truck: headlight beams, trailer, cab.
    const tx = left + (s.x + 0.5) * LANE_W * k, ty = yToPx(s.y);
    const tw = LANE_W * k * 0.62, cab = 2.4 * (H / (AHEAD + BEHIND)), trailer = 7 * (H / (AHEAD + BEHIND));
    const beam = ctx.createLinearGradient(0, ty - cab, 0, ty - cab - 150);
    beam.addColorStop(0, 'rgba(253,230,138,0.35)');
    beam.addColorStop(1, 'rgba(253,230,138,0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(tx - tw / 2, ty - cab);
    ctx.lineTo(tx - tw * 1.3, ty - cab - 150);
    ctx.lineTo(tx + tw * 1.3, ty - cab - 150);
    ctx.lineTo(tx + tw / 2, ty - cab);
    ctx.fill();
    ctx.fillStyle = '#9ca3af';
    ctx.fillRect(tx - tw / 2, ty, tw, trailer);
    ctx.fillStyle = colour;
    ctx.fillRect(tx - tw / 2, ty - cab, tw, cab + 2);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(tx - tw / 2 + 3, ty - cab + 3, tw - 6, cab * 0.32);
    ctx.fillStyle = '#fde68a';
    ctx.fillRect(tx - tw / 2 + 2, ty - cab - 2, 6, 3);
    ctx.fillRect(tx + tw / 2 - 8, ty - cab - 2, 6, 3);
    // A red flash right after a crash.
    if (s.tick < s.slowUntil && s.tick > s.slowUntil - 12) {
      ctx.fillStyle = 'rgba(244,63,94,0.25)';
      ctx.fillRect(0, 0, W, H);
    }
  }, [colour, road]);

  // Fixed-step loop: 30 ticks a second whatever the frame rate.
  useEffect(() => {
    if (phase !== 'run') return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const dt = 1000 / NIGHT_RUN.tps;
    const frame = (now: number) => {
      acc += Math.min(250, now - last);
      last = now;
      while (acc >= dt && !state.current.over) {
        const dir = pending.current;
        pending.current = 0;
        inputs.current.push(dir);
        stepRun(state.current, road, dir);
        acc -= dt;
      }
      const s = state.current;
      draw();
      setHud({ metres: Math.floor(s.y), fuel: Math.max(0, s.fuel), crashes: s.crashes, left: NIGHT_RUN.maxTicks - s.tick, kmh: Math.round(speedAt(s) * 3.6) });
      if (s.over) {
        setPhase('sending');
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [phase, road, draw]);

  // Countdown, then go.
  useEffect(() => {
    if (phase !== 'count') return;
    const id = setTimeout(() => (count <= 1 ? setPhase('run') : setCount(count - 1)), motionEnabled() ? 700 : 300);
    return () => clearTimeout(id);
  }, [phase, count]);

  // The server replays the run and decides.
  useEffect(() => {
    if (phase !== 'sending') return;
    api('/api/game/action', { type: 'nightRun', inputs: inputs.current })
      .then((r) => {
        const res = r as unknown as { metres: number; stars: number; xp: number; crashes: number; over: string };
        setResult(res);
        if (res.xp > 0) playCoin();
        setPhase('done');
        router.refresh();
      })
      .catch((e: Error) => {
        setError(e.message);
        setPhase('done');
      });
  }, [phase, router]);

  // Size the canvas to its box once, and draw the first frame.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const w = Math.min(420, c.parentElement!.clientWidth);
    c.width = w * 2;
    c.height = Math.round(w * 1.35) * 2;
    c.style.width = `${w}px`;
    c.style.height = `${Math.round(w * 1.35)}px`;
    draw();
  }, [draw]);

  const begin = () => {
    playSelect();
    state.current = startRun();
    inputs.current = [];
    pending.current = 0;
    setResult(null);
    setError(null);
    setCount(3);
    setPhase('count');
  };

  // Swipe or tap on the left/right half.
  const touchX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchX.current = e.touches[0]!.clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (phase !== 'run' || touchX.current === null) return;
    const x = e.changedTouches[0]!.clientX;
    const dx = x - touchX.current;
    const rect = canvas.current!.getBoundingClientRect();
    steer(Math.abs(dx) > 25 ? Math.sign(dx) : x < rect.left + rect.width / 2 ? -1 : 1);
    touchX.current = null;
  };

  return (
    <div className="night-run mx-auto flex max-w-[420px] flex-col items-center gap-2" data-testid="night-run">
      <div className="flex w-full items-center justify-between text-xs font-semibold text-mist-200">
        <span className="num">📏 {int(hud.metres)} м</span>
        <span className="num">{hud.kmh} км/ч</span>
        <span aria-label={t('Удари')}>{'💥'.repeat(hud.crashes)}{'·'.repeat(NIGHT_RUN.maxCrashes - hud.crashes)}</span>
        <span className="num">⏱ {Math.ceil(hud.left / NIGHT_RUN.tps)} с</span>
      </div>
      <div className="w-full" title={t('Гориво')}>
        <div className="stat-track"><div className="stat-fill" style={{ width: `${hud.fuel}%`, '--fill': hud.fuel < 25 ? '#f43f5e' : '#f6c343' } as React.CSSProperties} /></div>
      </div>
      <div className="relative w-full" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <canvas ref={canvas} className="night-run-canvas block rounded-2xl" aria-label={t('Нощен път')} />
        {phase !== 'run' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl bg-black/55 p-4 text-center">
            {phase === 'ready' && (
              <>
                <p className="font-display text-2xl font-bold text-white">🌙 {t('Нощен рейс')}</p>
                <p className="max-w-[18rem] text-sm text-mist-200">{t('Сменяй лентите, задминавай колите и събирай туби гориво. Три удара — край.')}</p>
                <button type="button" className="game-action game-action-gold flex-row px-8 py-3 text-base" onClick={begin} disabled={runsLeft <= 0} data-testid="night-run-start">
                  {runsLeft > 0 ? t('Тръгвай ({0} оставащи)', runsLeft) : t('Утре — нов рейс')}
                </button>
              </>
            )}
            {phase === 'count' && <p className="fx-pop font-display text-6xl font-bold text-gold-400">{count}</p>}
            {phase === 'sending' && <p className="text-sm text-mist-200">{t('Проверяваме рейса…')}</p>}
            {phase === 'done' && (
              <>
                {result ? (
                  <div data-testid="night-run-result" className="space-y-1">
                    <p className="text-3xl">{'★'.repeat(result.stars)}<span className="text-mist-500">{'★'.repeat(3 - result.stars)}</span></p>
                    <p className="font-display text-xl font-bold text-white">{t('{0} м', int(result.metres))}</p>
                    <p className="text-sm text-mist-200">{result.over === 'fuel' ? t('Свърши горивото.') : result.over === 'crashes' ? t('Три удара.') : t('Стигна до края!')}{result.xp > 0 && <span className="text-profit"> +{result.xp} {t('опит')}</span>}</p>
                  </div>
                ) : (
                  <p role="alert" className="text-sm text-loss">{error}</p>
                )}
                {runsLeft > 0 && <button type="button" className="game-action game-action-main flex-row px-6 py-2.5 text-sm" onClick={begin}>{t('Още веднъж ({0})', runsLeft)}</button>}
              </>
            )}
          </div>
        )}
      </div>
      <div className="grid w-full grid-cols-2 gap-2 sm:hidden">
        <button type="button" className="game-action flex-row py-3 text-lg" onPointerDown={() => steer(-1)} aria-label={t('Наляво')}>◀</button>
        <button type="button" className="game-action flex-row py-3 text-lg" onPointerDown={() => steer(1)} aria-label={t('Надясно')}>▶</button>
      </div>
      <p className="hidden text-xs text-mist-400 sm:block">{t('Стрелки ← → или A / D')}</p>
    </div>
  );
}
