'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { t, tx } from '@/i18n/t';

/** v2.0 New Game+: the start city and an explicit "I understand" before the career starts over. */
export function NewCareerForm({ cities }: { cities: { id: number; name: string }[] }) {
  const router = useRouter();
  const [cityId, setCityId] = useState(String(cities[0]?.id ?? ''));
  const [sure, setSure] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/game/action', { type: 'startNewCareer', cityId: Number(cityId), confirm: true });
      router.push('/game/contracts');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-3 text-sm">
      <label className="block space-y-1">
        <span className="text-mist-300">{t('Начален град')}</span>
        <select className="input py-2" value={cityId} onChange={(e) => setCityId(e.target.value)}>
          {cities.map((c) => <option key={c.id} value={c.id}>{tx(c.name)}</option>)}
        </select>
      </label>
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} className="mt-1" />
        <span>{t('Разбирам: камионите, ремаркетата, депата, наетите шофьори и парите ми изчезват, а нивото става 1. Това не може да се върне.')}</span>
      </label>
      <button className="btn-primary" disabled={!sure || busy || !cityId}>{busy ? '…' : t('Ново начало')}</button>
      {error && <p className="text-loss">{tx(error)}</p>}
    </form>
  );
}
