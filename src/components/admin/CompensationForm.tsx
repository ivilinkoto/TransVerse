'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { t } from '@/i18n/t';

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
  const label = `${amount} ${kind === 'money' ? t('лв.') : t('ТрансКоин')}`;
  const run = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await api<{ players: number }>('/api/admin/action', { type: 'compensateAll', kind, amount: Number(amount), reason });
      setDone(t('Готово: {0} за {1} играчи.', label, r.players));
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
        <select className="input w-36" value={kind} onChange={(e) => setKind(e.target.value as 'money' | 'coins')} aria-label={t('Какво')}>
          <option value="coins">{t('ТрансКоин')}</option>
          <option value="money">{t('Пари (лв.)')}</option>
        </select>
        <input className="input w-28" type="number" min={0} step={kind === 'money' ? 0.01 : 1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t('Колко')} aria-label={t('Колко')} />
        <input className="input min-w-0 flex-1" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('Причина (виждат я всички, напр. „прекъсване на 12.03“)')} maxLength={300} aria-label={t('Причина')} />
      </div>
      {asking ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-sig/40 bg-amber-sig/10 p-3 text-sm">
          <span>{t('Всеки активен играч получава {0}. Записва се в одита. Сигурен ли си?', label)}</span>
          <button className="btn-gold" disabled={busy} onClick={run}>{busy ? '…' : t('Да, раздай')}</button>
          <button className="btn-ghost" disabled={busy} onClick={() => setAsking(false)}>{t('Отказ')}</button>
        </div>
      ) : <button className="btn-gold" disabled={!ready} onClick={() => setAsking(true)}>{t('Компенсация за всички')}</button>}
      {done && <p className="text-sm text-profit">{done}</p>}
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
    </div>
  );
}
