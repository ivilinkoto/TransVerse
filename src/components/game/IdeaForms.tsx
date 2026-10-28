'use client';

import { Lightbulb } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { t, tx } from '@/i18n/t';

/** 1.1.4: a new idea for the game (title and a few lines). */
export function IdeaForm() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api('/api/game/action', { type: 'submitIdea', idea: { title, body } });
      setTitle('');
      setBody('');
      setMessage({ ok: true, text: t('Благодарим! Идеята е публикувана — другите играчи вече могат да гласуват.') });
      router.refresh();
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-2">
      <input className="input w-full" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} minLength={5} required placeholder={t('Накратко: какво да добавим или променим?')} aria-label={t('Заглавие')} />
      <textarea className="input min-h-[5rem] w-full" value={body} onChange={(e) => setBody(e.target.value)} maxLength={600} placeholder={t('Защо и как (по желание)')} aria-label={t('Описание')} />
      <button className="btn-primary" disabled={busy || title.trim().length < 5}><Lightbulb className="h-4 w-4" />{busy ? '…' : t('Предложи')}</button>
      {message && <p role="status" className={`text-sm ${message.ok ? 'text-profit' : 'text-loss'}`}>{tx(message.text)}</p>}
    </form>
  );
}

/** Staff: the idea's status and the answer shown under it. */
export function IdeaStatusForm({ ideaId, status, note }: { ideaId: string; status: string; note: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(status);
  const [text, setText] = useState(note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/admin/action', { type: 'ideaStatus', ideaId, status: value, note: text });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/5 p-2 text-xs">
      <select className="input w-36 py-1 text-xs" value={value} onChange={(e) => setValue(e.target.value)} aria-label={t('Статус')}>
        <option value="open">{t('Отворена')}</option>
        <option value="planned">{t('Планирана')}</option>
        <option value="done">{t('Направена')}</option>
        <option value="declined">{t('Отхвърлена')}</option>
        <option value="hidden">{t('Скрита')}</option>
      </select>
      <input className="input min-w-0 flex-1 py-1 text-xs" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder={t('Отговор на екипа (вижда се под идеята)')} aria-label={t('Отговор на екипа')} />
      <button type="button" className="btn-ghost px-2.5 py-1 text-xs" disabled={busy} onClick={save}>{busy ? '…' : t('Запази')}</button>
      {error && <span role="alert" className="text-loss">{tx(error)}</span>}
    </div>
  );
}
