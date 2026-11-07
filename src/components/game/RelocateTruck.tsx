'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client/api';
import { duration, money } from '@/lib/format';
import { relocateQuote } from '@/lib/game/relocate';
import { t, tx } from '@/i18n/t';

type City = { id: number; name: string; country: string; lat: number; lon: number };

/** 1.2.3.3: send a free truck empty to any city — the price and time shown before it goes. */
export function RelocateTruck({ vehicleId, from, preset = null }: { vehicleId: string; from: { lat: number; lon: number }; preset?: City | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(!!preset);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<City[]>([]);
  const [pick, setPick] = useState<City | null>(preset);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) return;
    const timer = setTimeout(async () => {
      try {
        setFound((await api<{ cities: City[] }>(`/api/geo/search?q=${encodeURIComponent(q.trim())}`)).cities);
      } catch {
        setFound([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  if (!open) return <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setOpen(true)} data-testid="relocate-open">{t('🚚 Премести в друг град')}</button>;
  const quote = pick ? relocateQuote([from.lat, from.lon], [pick.lat, pick.lon]) : null;
  const go = async () => {
    if (!pick) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/game/action', { type: 'relocateVehicle', vehicleId, cityId: pick.id });
      router.refresh();
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2" data-testid="relocate">
      <input className="input w-full" value={q} onChange={(e) => { setQ(e.target.value); setPick(null); }} placeholder={t('Град, напр. Пловдив')} aria-label={t('Град')} autoFocus={!preset} />
      {!pick && q.trim().length >= 2 && found.length > 0 && (
        <ul className="max-h-48 overflow-y-auto rounded-xl border border-asphalt-700">
          {found.map((c) => (
            <li key={c.id}><button type="button" className="w-full px-3 py-1.5 text-left text-sm hover:bg-asphalt-800" onClick={() => { setPick(c); setQ(tx(c.name)); }}>{tx(c.name)} <span className="text-mist-500">{c.country}</span></button></li>
          ))}
        </ul>
      )}
      {pick && quote && (
        <div className="rounded-xl border border-cyan-glow/40 bg-cyan-glow/5 p-2 text-sm">
          <p>{t('До {0}: {1} км · {2} · пристига след {3}', tx(pick.name), quote.km, money(quote.costCents), duration(quote.minutes))}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn-primary px-3 py-1.5 text-sm" disabled={busy} onClick={go} data-testid="relocate-go">{busy ? '…' : t('Тръгни · {0}', money(quote.costCents))}</button>
            <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={() => { setOpen(false); setPick(null); setQ(''); }}>{t('Отказ')}</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-loss">{error}</p>}
      <p className="text-xs text-mist-400">{t('Празен курс до всеки град: плащаш според разстоянието, камионът пристига след пътя. Прикаченото ремарке идва с него.')}</p>
    </div>
  );
}
