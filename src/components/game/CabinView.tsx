'use client';

import { useEffect, useState } from 'react';
import { stateAt, type Segment } from '@/lib/game/schedule';
import { t as tr, tx } from '@/i18n/t';

const flag = (code: string) => String.fromCodePoint(...[...code.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));

/** The sky outside by the local solar time at the truck's longitude. */
function sky(at: number, lon: number) {
  const d = new Date(at);
  const hour = (d.getUTCHours() + d.getUTCMinutes() / 60 + lon / 15 + 24) % 24;
  if (hour < 5 || hour >= 21) return { top: '#020617', bottom: '#1e293b', night: true };
  if (hour < 7) return { top: '#f59e0b', bottom: '#7dd3fc', night: false };
  if (hour >= 19) return { top: '#7c3aed', bottom: '#fb923c', night: false };
  return { top: '#38bdf8', bottom: '#e0f2fe', night: false };
}

/** The cab on a trip under way: the road through the windscreen, the gauges and the road ahead (v2.0). */
export function CabinView({ trip, serverNow }: { trip: { from: string; to: string; goods: string; tons: number; truck: string; lon: number; segments: Segment[]; emptyKm: number; loadedKm: number; borders: { km: number; from: string; to: string }[]; countries: string[] }; serverNow: number }) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const skew = Date.now() - serverNow;
    const timer = setInterval(() => setNow(Date.now() - skew), 1000);
    return () => clearInterval(timer);
  }, [serverNow]);
  const s = stateAt(trip.segments, now);
  const end = trip.segments.at(-1)?.end ?? now;
  const left = Math.max(0, end - now);
  const loaded = s.leg === 'loaded';
  const total = loaded ? trip.loadedKm : trip.emptyKm;
  const kmLeft = Math.max(0, total - s.km);
  const moving = s.segment?.kind === 'drive';
  const country = loaded ? [...trip.borders].filter((b) => b.km <= s.km).at(-1)?.to ?? trip.countries[0] : trip.countries[0];
  const nextBorder = loaded ? trip.borders.find((b) => b.km > s.km) : undefined;
  const air = sky(now, trip.lon);
  const status = !s.segment ? tr('Пристигна') : s.segment.kind === 'drive' ? tr('Кара') : s.segment.kind === 'ferry' ? tr('На ферибот') : s.segment.kind === 'rail' ? tr('На влака') : s.segment.kind === 'rest' ? tr('Почивка') : tr('Спира');
  return (
    <div className="overflow-hidden rounded-2xl border border-asphalt-700 bg-asphalt-950">
      {/* The windscreen. */}
      <div className="relative h-44" style={{ background: `linear-gradient(${air.top}, ${air.bottom})` }}>
        {air.night && <div className="absolute inset-0 opacity-60" style={{ backgroundImage: 'radial-gradient(1px 1px at 20% 30%, #fff, transparent), radial-gradient(1px 1px at 70% 20%, #fff, transparent), radial-gradient(1px 1px at 45% 12%, #fff, transparent)' }} />}
        <svg viewBox="0 0 400 176" className="absolute inset-0 h-full w-full" preserveAspectRatio="none" aria-hidden>
          <polygon points="0,176 400,176 230,90 170,90" fill={air.night ? '#111827' : '#4b5563'} />
          <polygon points="0,176 0,120 170,90" fill={air.night ? '#052e16' : '#3f7a3c'} />
          <polygon points="400,176 400,120 230,90" fill={air.night ? '#052e16' : '#3f7a3c'} />
          <line x1="200" y1="176" x2="200" y2="92" stroke="#f2f0e4" strokeWidth="4" strokeDasharray="14 14" className={moving ? 'cabin-road' : ''} />
        </svg>
        <div className="absolute left-3 top-3 rounded-lg bg-black/50 px-2 py-1 text-xs text-white">{country ? `${flag(country)} ` : ''}{status}</div>
      </div>
      {/* The dashboard. */}
      <div className="grid grid-cols-2 gap-3 p-4 text-sm sm:grid-cols-4">
        <div><div className="label">{tr('Маршрут')}</div><div className="font-semibold">{tx(trip.from)} → {tx(trip.to)}</div></div>
        <div><div className="label">{tr('Остават')}</div><div className="num font-display text-xl font-bold">{Math.round(kmLeft)} {tr('км')}</div></div>
        <div><div className="label">{tr('Пристигане след')}</div><div className="num font-display text-xl font-bold">{Math.floor(left / 3_600_000)}:{String(Math.floor((left % 3_600_000) / 60_000)).padStart(2, '0')}:{String(Math.floor((left % 60_000) / 1000)).padStart(2, '0')}</div></div>
        <div><div className="label">{tr('Товар')}</div><div>{loaded ? `${tx(trip.goods)} · ${trip.tons} ${tr('т')}` : tr('празен към товара')}</div></div>
        <div className="col-span-2"><div className="label">{tr('Камион')}</div><div>{trip.truck}</div></div>
        <div className="col-span-2"><div className="label">{tr('Следваща граница')}</div><div>{nextBorder ? `${flag(nextBorder.from)} → ${flag(nextBorder.to)} · ${Math.round(nextBorder.km - s.km)} ${tr('км')}` : '—'}</div></div>
      </div>
      <div className="h-1.5 bg-asphalt-800"><div className="h-full bg-volt-500" style={{ width: `${Math.round(s.progress * 100)}%` }} /></div>
    </div>
  );
}
