'use client';

import { PackagePlus, Truck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { api } from '@/lib/client/api';
import { money } from '@/lib/format';
import { rewardCents } from '@/lib/game/economy';
import type { CargoType } from '@/lib/game/cargo';

export interface DeskVehicle {
  id: string;
  label: string;
  cityId: number;
  bodies: string[];
  payloadTons: number;
}
export interface DeskBuyer {
  id: number;
  name: string;
  countryCode: string;
  priceCents: number;
  km: number;
}
interface StockRow {
  cargo: string;
  tons: number;
  costCents: number;
  avgCents: number;
}

const t1 = (n: number) => Math.floor(n * 10) / 10;

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: Record<string, unknown>, done?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/game/action', action);
      done?.();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

/** Buy goods into this depot's warehouse. */
export function BuyGoodsForm({ depotId, offers, freeTons, labels, balanceCents }: { depotId: string; offers: { cargo: string; priceCents: number }[]; freeTons: number; labels: Record<string, string>; balanceCents: number }) {
  const [cargo, setCargo] = useState(offers[0]?.cargo ?? '');
  const [tons, setTons] = useState(Math.min(10, t1(freeTons)));
  const { busy, error, run } = useAction();
  const price = offers.find((o) => o.cargo === cargo)?.priceCents ?? 0;
  const cost = Math.round(price * tons);
  if (!offers.length) return <p className="text-sm text-mist-400">В този град не се произвежда нищо за търговия.</p>;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_6rem] gap-2">
        <select className="input text-sm" value={cargo} onChange={(e) => setCargo(e.target.value)} aria-label="Стока">
          {offers.map((o) => <option key={o.cargo} value={o.cargo}>{labels[o.cargo]} · {money(o.priceCents)}/т</option>)}
        </select>
        <input className="input text-sm" type="number" min={0.5} step={0.5} max={t1(freeTons)} value={tons} onChange={(e) => setTons(Number(e.target.value))} aria-label="Тонове" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-mist-400">Общо: <span className="num font-semibold text-gold-400">{money(cost)}</span> · свободно {t1(freeTons)} т</span>
        <button type="button" className="btn-primary px-3 py-1.5 text-xs" disabled={busy || tons < 0.5 || tons > freeTons + 1e-6 || cost > balanceCents} onClick={() => void run({ type: 'buyGoods', depotId, cargo, tons })}>
          <PackagePlus className="h-4 w-4" />Купи
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-loss">{error}</p>}
    </div>
  );
}

/** Load goods from the warehouse and send them: to sell, or to another own warehouse. */
export function ShipGoodsForm({ depotId, depotCityId, row, label, bodies, vehicles, buyers, depots, exchange = false }: { depotId: string; depotCityId: number; row: StockRow; label: string; bodies: string[]; vehicles: DeskVehicle[]; buyers: DeskBuyer[]; depots: { cityId: number; name: string; free: number }[]; exchange?: boolean }) {
  const [open, setOpen] = useState(false);
  // v1.4: someone else hauls it (the freight exchange) instead of an own truck.
  const [byOthers, setByOthers] = useState(false);
  const [priceEur, setPriceEur] = useState<number | null>(null);
  const [mode, setMode] = useState<'sell' | 'store'>('sell');
  const fit = useMemo(() => vehicles.filter((v) => v.bodies.some((b) => bodies.includes(b))), [vehicles, bodies]);
  const [vehicleId, setVehicleId] = useState(fit.find((v) => v.cityId === depotCityId)?.id ?? fit[0]?.id ?? '');
  const vehicle = fit.find((v) => v.id === vehicleId);
  const targets = mode === 'sell' ? buyers.map((b) => ({ id: b.id, label: `${b.name} (${b.countryCode}) · ${money(b.priceCents)}/т · ~${b.km} км`, priceCents: b.priceCents })) : depots.filter((d) => d.cityId !== depotCityId).map((d) => ({ id: d.cityId, label: `${d.name} · свободно ${t1(d.free)} т`, priceCents: 0 }));
  const [dest, setDest] = useState<number>(targets[0]?.id ?? 0);
  const maxTons = t1(Math.min(row.tons, vehicle?.payloadTons ?? row.tons));
  const [tons, setTons] = useState(maxTons);
  const { busy, error, run } = useAction();
  const target = targets.find((t) => t.id === dest) ?? targets[0];
  const revenue = mode === 'sell' && target ? Math.round(target.priceCents * tons) : 0;
  const cost = Math.round(row.avgCents * tons);
  const offerTons = t1(Math.min(tons, row.tons));
  const suggested = target ? Math.round(rewardCents(row.cargo as CargoType, offerTons, buyers.find((b) => b.id === target.id)?.km ?? 300, 1) / 100) : 0;
  const price = priceEur ?? suggested;

  if (!open) return <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setOpen(true)}><Truck className="h-3.5 w-3.5" />Превози</button>;
  return (
    <div className="mt-2 w-full space-y-2 rounded-xl border border-cyan-glow/30 bg-cyan-glow/5 p-3 text-sm">
      {exchange && (
        <div className="flex gap-1.5">
          {[false, true].map((o) => (
            <button key={String(o)} type="button" onClick={() => setByOthers(o)} className={`rounded-full border px-3 py-1 text-xs ${byOthers === o ? 'border-volt-500/60 bg-volt-500/15 text-white' : 'border-asphalt-700 text-mist-400'}`}>{o ? 'Друг играч да го превози' : 'Сам'}</button>
          ))}
        </div>
      )}
      <div className="flex gap-1.5">
        {(['sell', 'store'] as const).map((m) => (
          <button key={m} type="button" onClick={() => { setMode(m); setDest(0); }} className={`rounded-full border px-3 py-1 text-xs ${mode === m ? 'border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow' : 'border-asphalt-700 text-mist-400'}`}>{m === 'sell' ? 'Продай там' : 'Към мой склад'}</button>
        ))}
      </div>
      {byOthers ? (
        !targets.length ? (
          <p className="text-xs text-mist-400">{mode === 'sell' ? 'Няма купувачи на тази стока.' : 'Нямаш друго депо.'}</p>
        ) : (
          <>
            <select className="input text-sm" value={target?.id} onChange={(e) => { setDest(Number(e.target.value)); setPriceEur(null); }} aria-label="Дестинация">
              {targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-mist-400">Тонове<input className="input mt-1 text-sm" type="number" min={0.5} step={0.5} max={row.tons} value={offerTons} onChange={(e) => { setTons(Number(e.target.value)); setPriceEur(null); }} /></label>
              <label className="text-xs text-mist-400">Плащаш на превозвача (лв.)<input className="input mt-1 text-sm" type="number" min={1} step={10} value={price} onChange={(e) => setPriceEur(Number(e.target.value))} /></label>
            </div>
            <p className="text-xs text-mist-400">Стоката излиза от склада, а сумата е в депозит. Плаща се на превозвача при доставката; ако за ден никой не поеме превоза, всичко се връща. Предложено ≈ {money(suggested * 100)} (колкото плаща обикновен възложител).</p>
            <button type="button" className="btn-primary px-3 py-1.5 text-xs" disabled={busy || !target || offerTons < 0.5 || price <= 0} onClick={() => void run({ type: 'postFreight', depotId, cargo: row.cargo, tons: offerTons, destCityId: target!.id, mode, priceEur: price }, () => setOpen(false))}>
              Пусни на борсата за превозвачи
            </button>
          </>
        )
      ) : !fit.length ? (
        <p className="text-xs text-amber-sig">Нямаш свободно превозно средство с надстройка за {label.toLowerCase()}.</p>
      ) : !targets.length ? (
        <p className="text-xs text-mist-400">{mode === 'sell' ? 'Няма купувачи на тази стока.' : 'Нямаш друго депо.'}</p>
      ) : (
        <>
          <select className="input text-sm" value={target?.id} onChange={(e) => setDest(Number(e.target.value))} aria-label="Дестинация">
            {targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            <select className="input text-sm" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} aria-label="Превозно средство">
              {fit.map((v) => <option key={v.id} value={v.id}>{v.label}{v.cityId !== depotCityId ? ' (идва празен)' : ''}</option>)}
            </select>
            <input className="input text-sm" type="number" min={0.5} step={0.5} max={maxTons} value={Math.min(tons, maxTons)} onChange={(e) => setTons(Number(e.target.value))} aria-label="Тонове" />
          </div>
          <p className="text-xs text-mist-400">
            {mode === 'sell' ? <>Очаквано: <span className="num font-semibold text-profit">{money(revenue)}</span> срещу {money(cost)} покупна цена ({revenue - cost >= 0 ? '+' : ''}{money(revenue - cost)}) — преди горивото и таксите. Продава се по цената в деня на пристигане.</> : <>Стоката се разтоварва в депото ти и чака там.</>}
          </p>
          <button type="button" className="btn-primary px-3 py-1.5 text-xs" disabled={busy || !vehicleId || !target || tons < 0.5 || tons > maxTons + 1e-6} onClick={() => void run({ type: 'shipGoods', depotId, cargo: row.cargo, tons: Math.min(tons, maxTons), destCityId: target!.id, vehicleId, mode }, () => setOpen(false))}>
            <Truck className="h-4 w-4" />Натовари и тръгвай
          </button>
        </>
      )}
      {error && <p role="alert" className="text-xs text-loss">{error}</p>}
    </div>
  );
}
