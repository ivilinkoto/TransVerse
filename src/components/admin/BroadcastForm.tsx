'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { t } from '@/i18n/t';

/** 1.1.3: the team's message on top of every game page — set or take it down (administrators; audited). */
export function BroadcastForm({ current }: { current: { text: string; tone: 'info' | 'warning'; until: string } | null }) {
  const router = useRouter();
  const [text, setText] = useState(current?.text ?? '');
  const [tone, setTone] = useState<'info' | 'warning'>(current?.tone ?? 'info');
  const [hours, setHours] = useState('24');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/admin/action', { type: 'broadcast', banner: { text: value, tone, hours: Number(hours) } });
      if (!value) setText('');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <textarea className="input min-h-[4.5rem] w-full" value={text} onChange={(e) => setText(e.target.value)} maxLength={240} placeholder={t('Напр. „Днес от 22:00 до 22:15 играта ще се обнови — курсовете продължават.“')} aria-label={t('Съобщение')} />
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-48" value={tone} onChange={(e) => setTone(e.target.value as 'info' | 'warning')} aria-label={t('Вид')}>
          <option value="info">{t('Новина (синьо)')}</option>
          <option value="warning">{t('Внимание (жълто)')}</option>
        </select>
        <select className="input w-36" value={hours} onChange={(e) => setHours(e.target.value)} aria-label={t('Колко дълго')}>
          {[1, 3, 6, 12, 24, 48, 72, 168].map((h) => <option key={h} value={h}>{h < 24 ? t('{0} ч', h) : h === 24 ? t('1 ден') : t('{0} дни', h / 24)}</option>)}
        </select>
        <button className="btn-primary" disabled={busy || !text.trim()} onClick={() => send(text.trim())}>{current ? t('Смени') : t('Покажи на всички')}</button>
        {current && <button className="btn-ghost" disabled={busy} onClick={() => send('')}>{t('Махни')}</button>}
      </div>
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
    </div>
  );
}
