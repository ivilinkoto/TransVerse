'use client';

import { Gift } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { money } from '@/lib/format';
import { BONUS_RULES } from '@/lib/game/company';
import { t } from '@/i18n/t';

/** A bonus from the treasury for one member (amount and a short note). */
export function BonusButton({ userId, username, roomCents }: { userId: string; username: string; roomCents: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(Math.min(BONUS_RULES.maxCents, Math.max(BONUS_RULES.minCents, Math.floor(roomCents / 100) * 100)) / 100));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setOpen(true)} disabled={roomCents < BONUS_RULES.minCents} title={roomCents < BONUS_RULES.minCents ? t('Днешният лимит за премии е изчерпан.') : undefined}><Gift className="h-4 w-4" />{t('Премия')}</button>;
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/game/action', { type: 'payBonus', bonus: { userId, amount: Number(amount), note } });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={send} className="flex min-w-[220px] flex-col gap-1.5 text-left">
      <label className="text-xs text-mist-400" htmlFor={`bonus-${userId}`}>{t('Премия за {0} (лв.)', username)}</label>
      <input id={`bonus-${userId}`} className="input py-1.5 text-sm" type="number" inputMode="numeric" min={BONUS_RULES.minCents / 100} max={Math.min(BONUS_RULES.maxCents, roomCents) / 100} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} required />
      <input className="input py-1.5 text-sm" maxLength={BONUS_RULES.noteMax} placeholder={t('За какво (по желание)')} value={note} onChange={(e) => setNote(e.target.value)} aria-label={t('Бележка към премията')} />
      <div className="flex gap-2">
        <button className="btn-gold flex-1 justify-center px-3 py-1.5 text-sm" disabled={busy}>{busy ? '…' : t('Дай премията')}</button>
        <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setOpen(false)}>{t('Отказ')}</button>
      </div>
      {error && <p role="alert" className="text-xs text-loss">{error}</p>}
      <p className="text-[11px] text-mist-400">{t('Днес остават {0} за премии.', money(roomCents))}</p>
    </form>
  );
}
