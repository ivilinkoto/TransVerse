'use client';

import { Building2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';

export function FoundCompanyForm({ cities, defaultCityId, ready, feeLabel }: { cities: { id: number; nameBg: string }[]; defaultCityId: number; ready: boolean; feeLabel: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api('/api/game/action', { type: 'foundCompany', name: form.get('name'), hqCityId: Number(form.get('hqCityId')) });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-mist-300">Име на компанията</span>
        <input id="name" name="name" className="input" required minLength={3} maxLength={40} placeholder="Балкан Експрес" />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-mist-300">Седалище (първото депо, 3 места)</span>
        <select id="hqCityId" name="hqCityId" className="input" defaultValue={defaultCityId}>
          {cities.map((c) => <option key={c.id} value={c.id}>{c.nameBg}</option>)}
        </select>
      </label>
      {error && <p role="alert" className="rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">{error}</p>}
      <button className="btn-gold w-full py-3" disabled={!ready || busy}>
        <Building2 className="h-4 w-4" />{busy ? 'Регистриране…' : `Основи компания · ${feeLabel}`}
      </button>
      {!ready && <p className="text-center text-xs text-mist-400">Изпълнете всички изисквания, за да активирате бутона.</p>}
    </form>
  );
}
