'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';

/** Administrator sets VIP for a number of days from today, or removes it. */
export function VipForm({ userId, activeUntil, today }: { userId: string; activeUntil: string | null; today: string }) {
  const router = useRouter();
  const [days, setDays] = useState('30');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (value: number) => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/admin/action', { type: 'setVip', userId, days: value });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const preview = Number(days) > 0 ? new Date(new Date(today).getTime() + Number(days) * 86_400_000).toLocaleDateString('bg-BG') : null;
  return (
    <div className="space-y-2">
      <p className="text-sm text-mist-300">{activeUntil ? `Активен VIP до ${new Date(activeUntil).toLocaleDateString('bg-BG')}.` : 'Няма активен VIP.'}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input className="input w-28" type="number" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} aria-label="Срок на VIP в дни" />
        <span className="text-sm text-mist-400">дни{preview ? ` · до ${preview}` : ''}</span>
        <button className="btn-gold" disabled={busy || !(Number(days) >= 1)} onClick={() => run(Number(days))}>{busy ? '…' : activeUntil ? 'Задай нов срок' : 'Дай VIP'}</button>
        {activeUntil && <button className="btn-ghost text-loss" disabled={busy} onClick={() => run(0)}>Премахни VIP</button>}
      </div>
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
    </div>
  );
}
