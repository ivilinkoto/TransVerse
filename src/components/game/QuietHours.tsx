'use client';

import { Moon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { t } from '@/i18n/t';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** Quiet hours for phone notifications (Sofia time). */
export function QuietHours({ value }: { value: { from: number; to: number } | null }) {
  const router = useRouter();
  const [from, setFrom] = useState(value?.from ?? 23);
  const [to, setTo] = useState(value?.to ?? 8);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (hours: { from: number; to: number } | null) => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/game/action', { type: 'quietHours', hours });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 text-sm">
      <p className="flex items-center gap-2 text-mist-300"><Moon className="h-4 w-4 text-prestige" />{value ? t('Тихи часове: {0} – {1} — тогава не идват известия на телефона и в Discord (в играта остават).', hh(value.from), hh(value.to)) : t('Без тихи часове — известията идват по всяко време.')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5">{t('от')}{' '}<select className="input w-auto py-1.5" value={from} onChange={(e) => setFrom(Number(e.target.value))} aria-label={t('Тихи часове от')}>{HOURS.map((h) => <option key={h} value={h}>{hh(h)}</option>)}</select></label>
        <label className="flex items-center gap-1.5">{t('до')}{' '}<select className="input w-auto py-1.5" value={to} onChange={(e) => setTo(Number(e.target.value))} aria-label={t('Тихи часове до')}>{HOURS.map((h) => <option key={h} value={h}>{hh(h)}</option>)}</select></label>
        <button type="button" className="btn-ghost py-1.5" disabled={busy || from === to} onClick={() => save({ from, to })}>{t('Запази')}</button>
        {value && <button type="button" className="text-xs text-mist-400 hover:text-white" disabled={busy} onClick={() => save(null)}>{t('Изключи')}</button>}
      </div>
      {error && <p role="alert" className="text-xs text-loss">{error}</p>}
    </div>
  );
}
