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
    const mPx = H / (AHEAD + BEHIND);
    // Fuel cans: a jerrycan with a handle and a cap.
    road.cans.forEach((can, i) => {
      if (s.takenCans.has(i) || can.y < s.y - BEHIND || can.y > s.y + AHEAD) return;
      drawCan(ctx, laneX(can.lane), yToPx(can.y));
    });
    // Traffic, seen from above, driving the same way (tail lights towards the truck).
    road.cars.forEach((car, i) => {
      const cy = carY(car, s.tick);
      if (cy < s.y - BEHIND || cy > s.y + AHEAD) return;
      ctx.globalAlpha = s.hitCars.has(i) ? 0.35 : 1;
      drawCar(ctx, laneX(car.lane), yToPx(cy), LANE_W * k * 0.44, Math.max(6 * mPx, LANE_W * k * 0.44 * 1.75), CAR_COLOURS[car.colour % CAR_COLOURS.length]!);
      ctx.globalAlpha = 1;
    });
    // The truck: headlight beams, then the trailer and the cab.
    drawTruck(ctx, left + (s.x + 0.5) * LANE_W * k, yToPx(s.y), LANE_W * k * 0.6, mPx, colour);
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

/** A rounded rectangle path (works where ctx.roundRect is missing). */
function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const q = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + q, y);
  ctx.arcTo(x + w, y, x + w, y + h, q);
  ctx.arcTo(x + w, y + h, x, y + h, q);
  ctx.arcTo(x, y + h, x, y, q);
  ctx.arcTo(x, y, x + w, y, q);
  ctx.closePath();
}

/** A car from above, nose up: rounded body, windscreen and rear window, roof, mirrors, wheels, glowing tail lights. */
function drawCar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, l: number, colour: string) {
  const top = y - l / 2;
  ctx.fillStyle = '#05070c';
  for (const [dx, dy] of [[-1, 0.2], [1, 0.2], [-1, 0.75], [1, 0.75]] as const) rounded(ctx, x + dx * (w / 2) - (dx < 0 ? 2 : 1), top + l * dy, 3, l * 0.16, 1.5), ctx.fill();
  const body = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  body.addColorStop(0, colour);
  body.addColorStop(0.5, '#ffffff33');
  body.addColorStop(0.52, colour);
  body.addColorStop(1, colour);
  ctx.fillStyle = colour;
  rounded(ctx, x - w / 2, top, w, l, w * 0.42);
  ctx.fill();
  ctx.fillStyle = body;
  ctx.globalAlpha *= 0.35;
  rounded(ctx, x - w / 2, top, w, l, w * 0.42);
  ctx.fill();
  ctx.globalAlpha /= 0.35;
  // Windscreen (front) and rear window, with the roof between them.
  ctx.fillStyle = 'rgba(15,23,42,0.85)';
  ctx.beginPath();
  ctx.moveTo(x - w * 0.36, top + l * 0.3);
  ctx.quadraticCurveTo(x, top + l * 0.2, x + w * 0.36, top + l * 0.3);
  ctx.lineTo(x + w * 0.3, top + l * 0.42);
  ctx.lineTo(x - w * 0.3, top + l * 0.42);
  ctx.closePath();
  ctx.fill();
  rounded(ctx, x - w * 0.3, top + l * 0.68, w * 0.6, l * 0.12, 3);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  rounded(ctx, x - w * 0.3, top + l * 0.44, w * 0.6, l * 0.22, 4);
  ctx.fill();
  // Mirrors.
  ctx.fillStyle = colour;
  rounded(ctx, x - w / 2 - 3, top + l * 0.3, 4, 3, 1.5);
  ctx.fill();
  rounded(ctx, x + w / 2 - 1, top + l * 0.3, 4, 3, 1.5);
  ctx.fill();
  // Tail lights with a glow.
  const glow = ctx.createRadialGradient(x, top + l, 1, x, top + l, w * 0.9);
  glow.addColorStop(0, 'rgba(244,63,94,0.35)');
  glow.addColorStop(1, 'rgba(244,63,94,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x - w, top + l - 4, w * 2, w * 0.9);
  ctx.fillStyle = '#fb7185';
  rounded(ctx, x - w / 2 + 2, top + l - 4, w * 0.22, 3, 1.5);
  ctx.fill();
  rounded(ctx, x + w / 2 - 2 - w * 0.22, top + l - 4, w * 0.22, 3, 1.5);
  ctx.fill();
}

/** The player's truck from above, cab up: light beams, a ribbed trailer, the cab with windscreen and mirrors. */
function drawTruck(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, mPx: number, colour: string) {
  // The road is squeezed lengthwise, so the truck keeps its own proportions (never shorter than real).
  const u = Math.max(mPx, w * 0.22);
  const cabL = 2.5 * u, trailerL = 7.2 * u, gap = 0.35 * u;
  const cabTop = y - cabL;
  // Headlight beams.
  for (const side of [-1, 1]) {
    const bx = x + side * w * 0.3;
    const beam = ctx.createLinearGradient(0, cabTop, 0, cabTop - 160);
    beam.addColorStop(0, 'rgba(253,230,138,0.32)');
    beam.addColorStop(1, 'rgba(253,230,138,0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(bx - 3, cabTop);
    ctx.lineTo(bx - w * 0.7, cabTop - 160);
    ctx.lineTo(bx + w * 0.7, cabTop - 160);
    ctx.lineTo(bx + 3, cabTop);
    ctx.fill();
  }
  // Wheels peeking out.
  ctx.fillStyle = '#05070c';
  for (const dy of [0.25, 0.8, 0.88]) for (const side of [-1, 1]) rounded(ctx, x + side * (w / 2) - (side < 0 ? 3 : 0), y + gap + trailerL * dy - 4, 3, 8, 1.5), ctx.fill();
  for (const side of [-1, 1]) rounded(ctx, x + side * (w * 0.46) - (side < 0 ? 3 : 0), cabTop + cabL * 0.15, 3, 7, 1.5), ctx.fill();
  // Trailer: rounded box with roof ribs and rear lights.
  const tr = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  tr.addColorStop(0, '#9ca3af');
  tr.addColorStop(0.5, '#e5e7eb');
  tr.addColorStop(1, '#9ca3af');
  ctx.fillStyle = tr;
  rounded(ctx, x - w / 2, y + gap, w, trailerL, 4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(15,23,42,0.18)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    const ry = y + gap + (trailerL * i) / 8;
    ctx.beginPath();
    ctx.moveTo(x - w / 2 + 3, ry);
    ctx.lineTo(x + w / 2 - 3, ry);
    ctx.stroke();
  }
  ctx.fillStyle = '#fb7185';
  rounded(ctx, x - w / 2 + 2, y + gap + trailerL - 4, 6, 3, 1.5);
  ctx.fill();
  rounded(ctx, x + w / 2 - 8, y + gap + trailerL - 4, 6, 3, 1.5);
  ctx.fill();
  // Cab: rounded nose, windscreen, roof deflector, mirrors.
  ctx.fillStyle = colour;
  rounded(ctx, x - w * 0.46, cabTop, w * 0.92, cabL + 2, w * 0.28);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  rounded(ctx, x - w * 0.3, cabTop + cabL * 0.45, w * 0.6, cabL * 0.4, 4);
  ctx.fill();
  ctx.fillStyle = 'rgba(15,23,42,0.85)';
  ctx.beginPath();
  ctx.moveTo(x - w * 0.36, cabTop + cabL * 0.12);
  ctx.quadraticCurveTo(x, cabTop + 1, x + w * 0.36, cabTop + cabL * 0.12);
  ctx.lineTo(x + w * 0.32, cabTop + cabL * 0.36);
  ctx.lineTo(x - w * 0.32, cabTop + cabL * 0.36);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#0f172a';
  rounded(ctx, x - w * 0.46 - 5, cabTop + cabL * 0.2, 5, 4, 2);
  ctx.fill();
  rounded(ctx, x + w * 0.46, cabTop + cabL * 0.2, 5, 4, 2);
  ctx.fill();
  ctx.fillStyle = '#fef9c3';
  rounded(ctx, x - w * 0.4, cabTop - 1, w * 0.18, 3, 1.5);
  ctx.fill();
  rounded(ctx, x + w * 0.22, cabTop - 1, w * 0.18, 3, 1.5);
  ctx.fill();
}

/** A red jerrycan with a handle and a cap. */
function drawCan(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const glow = ctx.createRadialGradient(x, y, 2, x, y, 18);
  glow.addColorStop(0, 'rgba(248,113,113,0.35)');
  glow.addColorStop(1, 'rgba(248,113,113,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x - 18, y - 18, 36, 36);
  ctx.fillStyle = '#dc2626';
  rounded(ctx, x - 7, y - 8, 14, 17, 3);
  ctx.fill();
  ctx.strokeStyle = '#fecaca';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - 4, y - 4);
  ctx.lineTo(x + 4, y + 5);
  ctx.moveTo(x + 4, y - 4);
  ctx.lineTo(x - 4, y + 5);
  ctx.stroke();
  ctx.fillStyle = '#7f1d1d';
  rounded(ctx, x - 5, y - 12, 7, 4, 1.5);
  ctx.fill();
  ctx.fillStyle = '#facc15';
  rounded(ctx, x + 3, y - 12, 3, 4, 1);
  ctx.fill();
}
