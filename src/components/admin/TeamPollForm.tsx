'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { t } from '@/i18n/t';

/** A new team poll: on the game's dashboard and in #анкети in Discord (administrators; audited). */
export function TeamPollForm({ maxOptions, hours: hourChoices }: { maxOptions: number; hours: readonly number[] }) {
  const router = useRouter();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [hours, setHours] = useState('24');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ discord: boolean }>('/api/admin/action', { type: 'teamPollCreate', question, options, hours: Number(hours) });
      setMsg({ ok: true, text: r.discord ? t('Анкетата е на таблото в играта и в #анкети в Discord.') : t('Анкетата е на таблото в играта (Discord не отговори или няма канал #анкети).') });
      setQuestion('');
      setOptions(['', '']);
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={send} className="space-y-2">
      <input className="input w-full" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={200} placeholder={t('Въпрос, напр. „Кой ивент да е следващият?“')} aria-label={t('Въпрос')} required />
      {options.map((o, i) => (
        <input key={i} className="input w-full" value={o} onChange={(e) => setOptions(options.map((x, k) => (k === i ? e.target.value : x)))} maxLength={80} placeholder={t('Отговор {0}', i + 1)} aria-label={t('Отговор {0}', i + 1)} required={i < 2} />
      ))}
      <div className="flex flex-wrap items-center gap-2">
        {options.length < maxOptions && <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setOptions([...options, ''])}>{t('+ отговор')}</button>}
        <select className="input w-36" value={hours} onChange={(e) => setHours(e.target.value)} aria-label={t('Колко дълго')}>
          {hourChoices.map((h) => <option key={h} value={h}>{h < 24 ? t('{0} ч', h) : h === 24 ? t('1 ден') : t('{0} дни', h / 24)}</option>)}
        </select>
        <button type="submit" className="btn-primary" disabled={busy}>{t('Пусни анкетата')}</button>
      </div>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-profit' : 'text-loss'}`}>{msg.text}</p>}
    </form>
  );
}
