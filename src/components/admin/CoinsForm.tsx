'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';

/** Administrator gives (positive) or takes away (negative) ТрансКоин. */
export function CoinsForm({ userId, balance }: { userId: string; balance: number }) {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/admin/action', { type: 'adjustCoins', userId, amount: Number(amount), reason });
      setAmount('');
      setReason('');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <p className="text-sm text-mist-300">Баланс: <span className="num font-semibold text-gold-400">{balance.toLocaleString('bg-BG')} TC</span></p>
      <div className="flex flex-wrap gap-2">
        <input className="input w-28" type="number" step={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="± TC" aria-label="Количество ТрансКоин" />
        <input className="input min-w-0 flex-1" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина (напр. награда от турнир)" maxLength={300} aria-label="Причина" />
      </div>
      <button className="btn-gold" disabled={busy || !Number(amount) || reason.trim().length < 3} onClick={run}>{busy ? '…' : Number(amount) < 0 ? 'Отнеми ТрансКоин' : 'Дай ТрансКоин'}</button>
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
    </div>
  );
}
