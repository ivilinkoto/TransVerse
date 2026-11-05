'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActionButton } from '@/components/ui/ActionButton';
import { int } from '@/lib/format';
import { motionEnabled, playCoin, playStamp } from '@/lib/client/motion';
import { burst, coinsEl, floatText, flyTo, walletEl } from './fx';
import { t, tx } from '@/i18n/t';

/**
 * 1.1.4.3: Truck Pass in motion. The bar fills from where the player saw it
 * last (kept on this device), a new level lands like a stamp, and rewards fly
 * to the wallet when they are claimed.
 */
export function PassProgress({ season, points, perLevel, maxLevel, fx, step = 0 }: { season: string; points: number; perLevel: number; maxLevel: number; fx: boolean; step?: number }) {
  // 1.2.5: level n costs perLevel + step·(n−1) points (step 0: the same for every level).
  const startOf = (n: number) => perLevel * n + (step * n * (n - 1)) / 2;
  const levelOf = (p: number) => {
    let n = 0;
    while (n < maxLevel && p >= startOf(n + 1)) n++;
    return n;
  };
  const costOf = (n: number) => perLevel + step * n;
  const intoOf = (p: number) => (levelOf(p) >= maxLevel ? costOf(maxLevel - 1) : p - startOf(levelOf(p)));
  // While filling: the points on screen; otherwise the real ones.
  const [filling, setFilling] = useState<number | null>(null);
  const shown = filling ?? points;
  const [stamp, setStamp] = useState<number | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const badge = useRef<HTMLDivElement>(null);
  const key = `tv-pass:${season}`;

  useEffect(() => {
    let seen: number | null = null;
    try {
      const raw = localStorage.getItem(key);
      seen = raw == null ? null : Number(raw);
      localStorage.setItem(key, String(points));
    } catch {
      /* private mode */
    }
    if (!fx || !motionEnabled() || seen == null || !Number.isFinite(seen) || seen >= points) return;
    const from = seen;
    const levelUps = levelOf(points) - levelOf(from);
    if (bar.current) floatText(bar.current, `+${int(points - from)} ${t('точки')}`, '#facc15');
    const start = performance.now();
    const duration = 1400 + Math.min(3, levelUps) * 500;
    let frame = 0;
    let lastLevel = levelOf(from);
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const value = Math.round(from + (points - from) * (1 - Math.pow(1 - p, 2)));
      setFilling(p < 1 ? value : null);
      const lv = levelOf(value);
      if (lv > lastLevel) {
        lastLevel = lv;
        setStamp(lv);
        playStamp();
        if (badge.current) burst(badge.current, { colors: ['#facc15', '#fde68a', '#f97316'], count: 36, spread: 160 });
      }
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      setFilling(null);
    };
    // Runs when the points change (a refresh after a delivery).
  }, [points]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (stamp == null) return;
    const id = setTimeout(() => setStamp(null), 1800);
    return () => clearTimeout(id);
  }, [stamp]);

  const level = levelOf(shown);
  const into = intoOf(shown);
  const need = costOf(Math.min(level, maxLevel - 1));
  return (
    <>
      <div ref={badge} className="relative flex h-20 w-20 flex-col items-center justify-center rounded-3xl border-2 border-gold-400/60 bg-gold-400/10">
        <span className="label text-[9px] text-gold-400">{t('ниво')}</span>
        <span key={level} className={`num font-display text-3xl font-bold text-gold-400 ${stamp != null ? 'fx-pop' : ''}`}>{tx(level)}</span>
        {stamp != null && (
          <span className="fx-stamp pointer-events-none absolute -right-24 -top-3 z-10 whitespace-nowrap rounded-xl border-2 border-gold-400 bg-asphalt-950/90 px-3 py-1 font-display text-lg font-bold text-gold-400 shadow-[0_0_24px_rgba(250,204,21,.5)]">{t('Ниво {0}!', stamp)}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between text-sm"><span className="text-mist-300">{level >= maxLevel ? t('Пропускът е завършен!') : t('До ниво {0}', level + 1)}</span><span className="num text-mist-400">{int(into)} / {int(need)}</span></div>
        <div ref={bar} className="relative mt-2 h-3 overflow-hidden rounded-full bg-asphalt-700">
          <div className="h-full rounded-full bg-gradient-to-r from-gold-500 to-gold-400" style={{ width: `${Math.max(2, Math.min(100, (into / need) * 100))}%` }} />
          {fx && <span className="pointer-events-none absolute -top-0.5 text-[11px] leading-none" style={{ left: `calc(${Math.max(2, Math.min(100, (into / need) * 100))}% - 10px)` }} aria-hidden="true">🚚</span>}
        </div>
        <div className="num mt-1 text-xs text-mist-400">{t('{0} сезонни точки общо', int(shown))}</div>
      </div>
    </>
  );
}

/** „Вземи наградите“ that pulses while rewards wait and sends them flying to the wallet. */
export function ClaimRewards({ children, fx }: { children: ReactNode; fx: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const done = () => {
    if (!fx || !ref.current) return;
    playCoin();
    burst(ref.current, { colors: ['#facc15', '#fde68a', '#22d3ee'], count: 24, spread: 120, shapes: 'sparks' });
    flyTo(ref.current, walletEl(), '💰', 6);
    flyTo(ref.current, coinsEl(), '🪙', 4);
  };
  return (
    <span ref={ref} className={`inline-flex rounded-xl ${fx ? 'fx-pulse' : ''}`}>
      <ActionButton action={{ type: 'claimSeasonPass' }} className="btn-gold" onDone={done}>{children}</ActionButton>
    </span>
  );
}
