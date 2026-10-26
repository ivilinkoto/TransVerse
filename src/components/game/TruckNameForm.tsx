'use client';

import { Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { api } from '@/lib/client/api';
import { TRUCK_NAME_MAX } from '@/lib/game/truck-names';
import { t } from '@/i18n/t';

/** v1.1.1: give the truck a name (shown next to the plate); empty clears it. */
export function TruckNameForm({ vehicleId, nickname }: { vehicleId: string; nickname: string | null }) {
  const router = useRouter();
  const [name, setName] = useState(nickname ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, start] = useTransition();
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api('/api/game/action', { type: 'nameVehicle', vehicleId, name });
      setSaved(true);
      start(() => router.refresh());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} className="flex flex-wrap items-center gap-2">
      <label className="flex min-w-0 flex-1 items-center gap-2">
        <Pencil className="h-4 w-4 shrink-0 text-mist-400" aria-hidden />
        <span className="sr-only">{t('Име на камиона')}</span>
        <input className="input min-w-0 flex-1 py-2" value={name} maxLength={TRUCK_NAME_MAX} placeholder={t('Име на камиона (по желание)')} onChange={(e) => { setName(e.target.value); setSaved(false); }} />
      </label>
      <button type="submit" className="btn-primary px-3 py-2 text-sm" disabled={busy || name.trim() === (nickname ?? '')}>{t('Запази')}</button>
      {saved && <span role="status" className="text-xs text-profit">{t('Запазено.')}</span>}
      {error && <span role="alert" className="w-full text-xs text-loss">{error}</span>}
    </form>
  );
}
