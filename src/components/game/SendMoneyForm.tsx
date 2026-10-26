'use client';

import { Banknote, Send } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { money } from '@/lib/format';
import { TRANSFER_RULES, transferFeeCents } from '@/lib/game/transfers';
import { t, tx } from '@/i18n/t';

/** Sends game money to another player (amount in whole leva; the fee is shown before sending). */
export function SendMoneyForm({ userId, username, onDone }: { userId: string; username: string; onDone?: () => void }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const cents = Math.max(0, Math.floor(Number(amount) || 0)) * 100;
  const fee = cents ? transferFeeCents(cents) : 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cents) return;
    if (!window.confirm(t('Да изпратим ли {0} на {1}? Таксата е {2} — общо {3}', money(cents), username, money(fee), money(cents + fee)))) return;
    setBusy(true);
    setMessage(null);
    try {
      await api('/api/game/action', { type: 'sendMoney', transfer: { toUserId: userId, amount: cents / 100, note } });
      setMessage({ ok: true, text: t('Изпрати {0} на {1}.', money(cents), username) });
      setAmount('');
      setNote('');
      onDone?.();
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2 rounded-xl border border-asphalt-700 bg-asphalt-850 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold"><Banknote className="h-4 w-4 text-gold-400" />{t('Изпрати пари на {0}', username)}</div>
      <div className="flex gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{t('Сума в лева')}</span>
          <input className="input w-full pr-10" type="number" inputMode="numeric" min={TRANSFER_RULES.minCents / 100} max={TRANSFER_RULES.dailyLimitCents / 100} step={1} placeholder={t('Сума')} value={amount} onChange={(e) => setAmount(e.target.value)} required />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-mist-400">{t('лв.')}</span>
        </label>
        <button type="submit" className="btn-gold shrink-0" disabled={busy || !cents}><Send className="h-4 w-4" />{t('Изпрати')}</button>
      </div>
      <input className="input w-full" maxLength={TRANSFER_RULES.noteMax} placeholder={t('Бележка (по избор)')} value={note} onChange={(e) => setNote(e.target.value)} aria-label={t('Бележка')} />
      <p className="text-xs text-mist-400">
        {t('{0}От ниво {1}, до {2} за 24 часа, не и към профил от същата мрежа.', cents ? t('Такса {0} %: {1} · общо {2} ', Math.round(TRANSFER_RULES.feeShare * 100), money(fee), money(cents + fee)) : '', TRANSFER_RULES.minLevel, money(TRANSFER_RULES.dailyLimitCents))}
      </p>
      {message && <p role="status" className={`text-sm ${message.ok ? 'text-profit' : 'text-loss'}`}>{tx(message.text)}</p>}
    </form>
  );
}
