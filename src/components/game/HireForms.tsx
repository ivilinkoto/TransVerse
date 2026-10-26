'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { t as tr, tx, intlLocale } from '@/i18n/t';

function useRun() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (action: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/game/action', action);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, run };
}

const Err = ({ error }: { error: string | null }) => (error ? <p role="alert" className="text-sm text-loss">{error}</p> : null);

/** A bid on the rare plate of the week (v1.6). */
export function PlateBidForm({ minBid, balance, weekKey }: { minBid: number; balance: number; weekKey: string }) {
  const [coins, setCoins] = useState(minBid);
  const { error, busy, run } = useRun();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input type="number" className="input w-32" min={minBid} value={coins} onChange={(e) => setCoins(Number(e.target.value) || minBid)} />
        <span className="text-sm text-mist-400">{tr('TC (поне {0}; имаш {1})', minBid, balance)}</span>
        <button type="button" className="btn-primary" disabled={busy || coins < minBid || coins > balance} onClick={() => run({ type: 'bidPlate', coins, weekKey })}>{tr('Наддай')}</button>
      </div>
      <Err error={error} />
    </div>
  );
}

/** The winner fits a won plate on an own truck. */
export function FitPlateForm({ weekKey, trucks }: { weekKey: string; trucks: { id: string; label: string }[] }) {
  const [vehicleId, setVehicleId] = useState(trucks[0]?.id ?? '');
  const { error, busy, run } = useRun();
  if (!trucks.length) return <p className="text-sm text-mist-400">{tr('Нямаш собствен камион за номера.')}</p>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>{trucks.map((t) => <option key={t.id} value={t.id}>{tx(t.label)}</option>)}</select>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => run({ type: 'fitRarePlate', weekKey, vehicleId })}>{tr('Сложи номера')}</button>
      </div>
      <Err error={error} />
    </div>
  );
}

/** The owner offers an own idle trailer for hire. */
export function OfferTrailerForm({ trailers, maxDays }: { trailers: { id: string; label: string }[]; maxDays: number }) {
  const [trailerId, setTrailerId] = useState(trailers[0]?.id ?? '');
  const [price, setPrice] = useState(80);
  const [days, setDays] = useState(3);
  const { error, busy, run } = useRun();
  if (!trailers.length) return <p className="text-sm text-mist-400">{tr('Нямаш свободно собствено ремарке.')}</p>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select className="input" value={trailerId} onChange={(e) => setTrailerId(e.target.value)}>{trailers.map((t) => <option key={t.id} value={t.id}>{tx(t.label)}</option>)}</select>
        <label className="flex items-center gap-1"><input type="number" className="input w-24" min={10} value={price} onChange={(e) => setPrice(Number(e.target.value) || 0)} />{' '}{tr('лв./ден')}</label>
        <label className="flex items-center gap-1">{tr('до')}{' '}<input type="number" className="input w-16" min={1} max={maxDays} value={days} onChange={(e) => setDays(Number(e.target.value) || 1)} />{' '}{tr('дни')}</label>
        <button type="button" className="btn-primary" disabled={busy || !trailerId} onClick={() => run({ type: 'offerTrailer', trailerId, pricePerDay: price, maxDays: days })}>{tr('Предложи')}</button>
      </div>
      <Err error={error} />
    </div>
  );
}

/** Hire a trailer someone offers. */
export function HireTrailerForm({ hireId, maxDays, pricePerDayCents }: { hireId: string; maxDays: number; pricePerDayCents: number }) {
  const [days, setDays] = useState(1);
  const { error, busy, run } = useRun();
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-sm">
        <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>{Array.from({ length: maxDays }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d} {d === 1 ? tr('ден') : tr('дни')}</option>)}</select>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => run({ type: 'hireTrailer', hireId, days })}>{tr('Наеми за {0} лв.', ((pricePerDayCents * days) / 100).toLocaleString(intlLocale()))}</button>
      </div>
      <Err error={error} />
    </div>
  );
}
