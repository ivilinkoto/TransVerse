'use client';

import { useEffect, useState } from 'react';

/**
 * 1.2.3.6 „Нов облик“: a game stat bar — it fills from empty when it appears, in a
 * colour that follows the value (green → amber → red) unless one is given.
 */
export function StatBar({ label, value, max = 100, text, colour, icon }: { label: string; value: number; max?: number; text?: string; colour?: string; icon?: string }) {
  const share = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(share));
    return () => cancelAnimationFrame(id);
  }, [share]);
  const tone = colour ?? (share >= 0.66 ? '#34d399' : share >= 0.33 ? '#f59e0b' : '#ef4444');
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold uppercase tracking-wider text-mist-300">{icon && <span className="mr-1" aria-hidden>{icon}</span>}{label}</span>
        <span className="num font-bold text-white">{text ?? `${Math.round(share * 100)}%`}</span>
      </div>
      <div className="stat-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(value)}>
        <div className="stat-fill" style={{ width: `${shown * 100}%`, '--fill': tone } as React.CSSProperties} />
      </div>
    </div>
  );
}

/** A small framed fact (a number with a label) for game windows. */
export function StatTile({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="stat-tile flex items-center gap-2.5 rounded-2xl px-3 py-2.5">
      <span className="text-xl" aria-hidden>{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-[10px] font-semibold uppercase tracking-wider text-mist-400">{label}</span>
        <span className="num block truncate text-sm font-bold text-white">{value}</span>
      </span>
    </div>
  );
}
