'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';

/** "Компенсация за всички": money or ТрансКоин for every active player (administrators; audited). */
export function CompensationForm() {
  const router = useRouter();
  const [kind, setKind] = useState<'money' | 'coins'>('coins');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = `${amount} ${kind === 'money' ? 'лв.' : 'ТрансКоин'}`;
  const run = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await api<{ players: number }>('/api/admin/action', { type: 'compensateAll', kind, amount: Number(amount), reason });
      setDone(`Готово: ${label} за ${r.players} играчи.`);
      setAmount('');
      setReason('');
      setAsking(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const ready = Number(amount) > 0 && reason.trim().length >= 5;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <select className="input w-36" value={kind} onChange={(e) => setKind(e.target.value as 'money' | 'coins')} aria-label="Какво">
          <option value="coins">ТрансКоин</option>
          <option value="money">Пари (лв.)</option>
        </select>
        <input className="input w-28" type="number" min={0} step={kind === 'money' ? 0.01 : 1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Колко" aria-label="Колко" />
        <input className="input min-w-0 flex-1" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина (виждат я всички, напр. „прекъсване на 12.03“)" maxLength={300} aria-label="Причина" />
      </div>
      {asking ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-sig/40 bg-amber-sig/10 p-3 text-sm">
          <span>Всеки активен играч получава {label}. Записва се в одита. Сигурен ли си?</span>
          <button className="btn-gold" disabled={busy} onClick={run}>{busy ? '…' : 'Да, раздай'}</button>
          <button className="btn-ghost" disabled={busy} onClick={() => setAsking(false)}>Отказ</button>
        </div>
      ) : <button className="btn-gold" disabled={!ready} onClick={() => setAsking(true)}>Компенсация за всички</button>}
      {done && <p className="text-sm text-profit">{done}</p>}
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
    </div>
  );
}
