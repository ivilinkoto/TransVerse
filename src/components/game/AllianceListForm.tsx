'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';

interface StockRow {
  depotId: string;
  city: string;
  cargoType: string;
  label: string;
  tons: number;
  range: { min: number; max: number; base: number };
}

/** Puts goods from one of the player's warehouses on the alliance warehouse board. */
export function AllianceListForm({ stock }: { stock: StockRow[] }) {
  const router = useRouter();
  const [pick, setPick] = useState(0);
  const row = stock[pick];
  // Whole leva inside the allowed range.
  const lo = (r: StockRow) => Math.ceil(r.range.min / 100);
  const hi = (r: StockRow) => Math.floor(r.range.max / 100);
  const [tons, setTons] = useState(row ? Math.min(row.tons, 10) : 0);
  const [price, setPrice] = useState(row ? Math.round(row.range.base / 100) : 0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!row) return <p className="text-xs text-mist-400">Нямаш стока в складовете си — купи от „Търговия“, за да продаваш на съюза.</p>;
  const choose = (i: number) => {
    setPick(i);
    setTons(Math.min(stock[i]!.tons, 10));
    setPrice(Math.round(stock[i]!.range.base / 100));
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/game/action', { type: 'listForAlliance', depotId: row.depotId, cargo: row.cargoType, tons, pricePerTon: price });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex flex-wrap items-end gap-2 text-xs text-mist-300">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          Стока
          <select className="input py-2 text-sm" value={pick} onChange={(e) => choose(Number(e.target.value))}>
            {stock.map((s, i) => <option key={`${s.depotId}-${s.cargoType}`} value={i}>{s.label} · {s.city} · {s.tons} т</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Тона
          <input type="number" className="input w-24 py-2 text-sm" min={1} max={row.tons} step={0.1} value={tons} onChange={(e) => setTons(Number(e.target.value))} />
        </label>
        <label className="flex flex-col gap-1">
          лв./т ({lo(row)}–{hi(row)})
          <input type="number" className="input w-28 py-2 text-sm" min={lo(row)} max={hi(row)} value={price} onChange={(e) => setPrice(Number(e.target.value))} />
        </label>
        <button className="btn-primary py-2" disabled={busy || !(tons > 0)}>{busy ? '…' : 'Обяви'}</button>
      </div>
      {error && <p role="alert" className="text-xs text-loss">{error}</p>}
    </form>
  );
}
