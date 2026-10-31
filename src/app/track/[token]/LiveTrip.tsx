'use client';

import { useEffect, useState } from 'react';
import { t } from '@/i18n/t';

/** 1.1.4.2: the trip's progress, ticking in the browser. */
export function LiveTrip({ startedAt, etaAt, done, from, to }: { startedAt: string; etaAt: string; done: boolean; from: { lat: number; lon: number; name: string }; to: { lat: number; lon: number; name: string } }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 5_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  const start = new Date(startedAt).getTime();
  const end = new Date(etaAt).getTime();
  const share = done ? 1 : now == null ? 0 : Math.min(1, Math.max(0, (now - start) / Math.max(1, end - start)));
  const left = now == null ? null : Math.max(0, Math.round((end - now) / 60_000));
  // A simple straight-line sketch between the two real cities (north up).
  const w = 600;
  const h = 220;
  const lons = [from.lon, to.lon];
  const lats = [from.lat, to.lat];
  const pad = 0.6;
  const minLon = Math.min(...lons) - pad;
  const maxLon = Math.max(...lons) + pad;
  const minLat = Math.min(...lats) - pad;
  const maxLat = Math.max(...lats) + pad;
  const x = (lon: number) => 30 + ((lon - minLon) / Math.max(0.01, maxLon - minLon)) * (w - 60);
  const y = (lat: number) => h - 30 - ((lat - minLat) / Math.max(0.01, maxLat - minLat)) * (h - 60);
  const truck = { x: x(from.lon) + (x(to.lon) - x(from.lon)) * share, y: y(from.lat) + (y(to.lat) - y(from.lat)) * share };
  return (
    <div className="space-y-3">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full rounded-2xl border border-asphalt-700 bg-asphalt-900" role="img" aria-label={t('{0} → {1}', from.name, to.name)}>
        <line x1={x(from.lon)} y1={y(from.lat)} x2={x(to.lon)} y2={y(to.lat)} stroke="#334155" strokeWidth="6" strokeLinecap="round" />
        <line x1={x(from.lon)} y1={y(from.lat)} x2={truck.x} y2={truck.y} stroke="#22d3ee" strokeWidth="6" strokeLinecap="round" />
        <circle cx={x(from.lon)} cy={y(from.lat)} r="7" fill="#f6c343" />
        <circle cx={x(to.lon)} cy={y(to.lat)} r="7" fill="#34d399" />
        <text x={x(from.lon)} y={y(from.lat) - 14} textAnchor="middle" fill="#e8eef7" fontSize="14">{from.name}</text>
        <text x={x(to.lon)} y={y(to.lat) - 14} textAnchor="middle" fill="#e8eef7" fontSize="14">{to.name}</text>
        <text x={truck.x} y={truck.y + 6} textAnchor="middle" fontSize="20">🚚</text>
      </svg>
      <div className="h-2 overflow-hidden rounded-full bg-asphalt-800"><div className="h-full bg-cyan-glow" style={{ width: `${Math.round(share * 100)}%` }} /></div>
      <p className="text-center text-sm text-mist-300">{done || share >= 1 ? t('✓ Пристигна') : left == null ? '…' : t('Още около {0} мин · {1}%', left, Math.round(share * 100))}</p>
    </div>
  );
}
