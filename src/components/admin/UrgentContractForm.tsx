'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';

export interface CityOption {
  id: number;
  name: string;
  country: string;
}

export function UrgentContractForm({ cities, cargoTypes }: { cities: CityOption[]; cargoTypes: { id: string; label: string; maxTons: number }[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const countries = [...new Set(cities.map((c) => c.country))];
  const options = countries.map((country) => (
    <optgroup key={country} label={country}>
      {cities.filter((c) => c.country === country).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </optgroup>
  ));

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await api('/api/admin/action', {
        type: 'createUrgentContract',
        contract: {
          goods: f.get('goods'),
          cargoType: f.get('cargoType'),
          weightTons: Number(f.get('weightTons')),
          rewardEur: Number(f.get('rewardEur')),
          originCityId: Number(f.get('originCityId')),
          destCityId: Number(f.get('destCityId')),
          windowMinutes: Number(f.get('windowMinutes')),
          speedFactor: Number(f.get('speedFactor')),
          expiresHours: Number(f.get('expiresHours')),
          announce: f.get('announce') === 'on',
        },
      });
      setDone(true);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const field = 'mb-1.5 block text-sm font-medium text-mist-300';
  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <label className="block sm:col-span-2"><span className={field}>Име на товара</span><input name="goods" className="input" required minLength={2} maxLength={60} placeholder="Медицинско оборудване" /></label>
      <label className="block"><span className={field}>Вид товар (определя нужната надстройка и лиценз)</span>
        <select name="cargoType" className="input" defaultValue="pallets">{cargoTypes.map((c) => <option key={c.id} value={c.id}>{c.label} (до {c.maxTons} т)</option>)}</select>
      </label>
      <label className="block"><span className={field}>Тегло (т)</span><input name="weightTons" type="number" step="0.1" min={0.1} max={40} defaultValue={1} className="input" required /></label>
      <label className="block"><span className={field}>Начална точка</span><select name="originCityId" className="input" required defaultValue="">{[<option key="" value="" disabled>— град —</option>, ...options]}</select></label>
      <label className="block"><span className={field}>Крайна точка</span><select name="destCityId" className="input" required defaultValue="">{[<option key="" value="" disabled>— град —</option>, ...options]}</select></label>
      <label className="block"><span className={field}>Цена на доставката (€)</span><input name="rewardEur" type="number" min={1} step={1} defaultValue={2500} className="input" required /></label>
      <label className="block"><span className={field}>Срок за доставка (минути от приемането)</span><input name="windowMinutes" type="number" min={5} max={2880} defaultValue={60} className="input" required /></label>
      <label className="block"><span className={field}>Колко по-бързо върви товарът</span>
        <select name="speedFactor" className="input" defaultValue="2"><option value="1">Нормално (×1)</option><option value="1.5">×1,5</option><option value="2">×2</option><option value="3">×3</option><option value="5">×5</option></select>
      </label>
      <label className="block"><span className={field}>Остава на борсата (часа)</span><input name="expiresHours" type="number" min={1} max={72} defaultValue={6} className="input" required /></label>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input name="announce" type="checkbox" defaultChecked />Изпрати известие до всички играчи</label>
      {error && <p role="alert" className="rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss sm:col-span-2">{error}</p>}
      {done && <p role="status" className="text-sm text-profit sm:col-span-2">Спешната доставка е публикувана на борсата.</p>}
      <div className="sm:col-span-2"><button className="btn-danger" disabled={busy}>{busy ? 'Публикуване…' : 'Публикувай спешна доставка'}</button></div>
    </form>
  );
}
