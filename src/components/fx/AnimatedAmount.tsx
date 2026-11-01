'use client';

import { useEffect, useRef, useState } from 'react';
import { useFeature } from '@/components/game/Features';
import { money, int } from '@/lib/format';
import { motionEnabled, playCoin } from '@/lib/client/motion';
import { floatText } from './fx';

/**
 * 1.1.4.3: an amount in the top bar that rolls from the old value to the new
 * one and shows the difference rising above it („+2 400 лв.“).
 */
export function AnimatedAmount({ value, kind, suffix }: { value: number; kind: 'money' | 'coins'; suffix?: React.ReactNode }) {
  const on = useFeature('game_fx');
  // While rolling: the value on screen; otherwise the real one.
  const [rolling, setRolling] = useState<number | null>(null);
  const prev = useRef(value);
  const ref = useRef<HTMLSpanElement>(null);
  const fmt = (v: number) => (kind === 'money' ? money(v) : int(v));

  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from === value) return;
    if (!on || !motionEnabled()) return;
    const diff = value - from;
    if (ref.current) {
      const text = kind === 'money' ? `${diff > 0 ? '+' : '−'}${money(Math.abs(diff))}` : `${diff > 0 ? '+' : '−'}${int(Math.abs(diff))} TC`;
      const r = ref.current.getBoundingClientRect();
      floatText({ x: r.left + r.width / 2, y: r.bottom + 4 }, text, diff > 0 ? (kind === 'money' ? '#4ade80' : '#22d3ee') : '#f87171');
    }
    if (diff > 0) playCoin();
    const start = performance.now();
    const duration = Math.min(1200, 500 + Math.log10(Math.abs(diff) + 1) * 120);
    let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setRolling(p < 1 ? Math.round(from + diff * eased) : null);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      setRolling(null);
    };
  }, [value, on, kind]);

  return (
    <span ref={ref} className="tabular-nums">
      {fmt(rolling ?? value)}
      {suffix}
    </span>
  );
}
