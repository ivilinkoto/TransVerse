'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client/api';

/** Time left of an auction; refreshes the page every few seconds so new bids show up. */
export function AuctionCountdown({ endsAt }: { endsAt: string }) {
  const router = useRouter();
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, new Date(endsAt).getTime() - Date.now()));
    tick();
    const t = setInterval(tick, 1000);
    const r = setInterval(() => router.refresh(), 8000);
    return () => {
      clearInterval(t);
      clearInterval(r);
    };
  }, [endsAt, router]);
  if (left == null) return <span className="num">—</span>;
  const s = Math.ceil(left / 1000);
  return <span className={`num ${s < 60 ? 'text-loss' : ''}`}>{s <= 0 ? 'приключва…' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}</span>;
}

/** The bid form: the lowest price (whole euro) the player will haul the load for. */
export function AuctionBid({ auctionId, maxEur, floorEur }: { auctionId: string; maxEur: number; floorEur: number }) {
  const router = useRouter();
  const [value, setValue] = useState(String(maxEur));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api('/api/game/action', { type: 'auctionBid', auctionId, amountEur: Number(value) });
      setMessage({ ok: true, text: 'Офертата е приета.' });
      router.refresh();
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-1.5">
      <div className="flex gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Твоята цена в евро</span>
          <input className="input pr-8" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ''))} />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-mist-400">€</span>
        </label>
        <button type="submit" className="btn-gold" disabled={busy || !value}>{busy ? '…' : 'Наддай'}</button>
      </div>
      <p className="text-xs text-mist-400">Между {floorEur.toLocaleString('bg-BG')} € и {maxEur.toLocaleString('bg-BG')} €. Печели най-ниската цена.</p>
      {message && <p role="status" className={`text-xs ${message.ok ? 'text-profit' : 'text-loss'}`}>{message.text}</p>}
    </form>
  );
}
