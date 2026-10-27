'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { t } from '@/i18n/t';

/** 1.1.3: ready texts for the usual cases (the admin edits them before sending). */
const templates = () =>
  [
    { label: t('Поддръжка'), tone: 'warning', text: t('Днес от 22:00 до 22:15 играта ще се обнови. Курсовете продължават, но страницата може да не отговаря няколко минути.') },
    { label: t('Ивент'), tone: 'info', text: t('Ивентът започва! Виж наградите и правилата в раздел „Ивенти“.') },
    { label: t('Известен проблем'), tone: 'warning', text: t('Знаем за проблем с … и работим по него. Благодарим за търпението!') },
    { label: t('Поправено'), tone: 'info', text: t('Проблемът с … е поправен. Ако още го виждаш, обнови страницата или пиши в „Помощ“.') },
  ] as const;

/** 1.1.3: the team's message on top of every game page — set, schedule or take it down (administrators; audited). */
export function BroadcastForm({ current }: { current: { text: string; tone: 'info' | 'warning'; until: string } | null }) {
  const router = useRouter();
  const [text, setText] = useState(current?.text ?? '');
  const [tone, setTone] = useState<'info' | 'warning'>(current?.tone ?? 'info');
  const [hours, setHours] = useState('24');
  const [start, setStart] = useState('');
  const [discord, setDiscord] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      // The time is picked in the admin's browser time and sent as an exact moment.
      await api('/api/admin/action', { type: 'broadcast', banner: { text: value, tone, hours: Number(hours), startsAt: start ? new Date(start).toISOString() : '', discord } });
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
      <div className="flex flex-wrap gap-1.5">
        <span className="text-xs text-mist-400">{t('Шаблони:')}</span>
        {templates().map((tp) => <button key={tp.label} type="button" className="rounded-full border border-asphalt-700 px-2.5 py-0.5 text-xs text-mist-300 hover:text-white" onClick={() => { setText(tp.text); setTone(tp.tone); }}>{tp.label}</button>)}
      </div>
      <textarea className="input min-h-[4.5rem] w-full" value={text} onChange={(e) => setText(e.target.value)} maxLength={240} placeholder={t('Напр. „Днес от 22:00 до 22:15 играта ще се обнови — курсовете продължават.“')} aria-label={t('Съобщение')} />
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-48" value={tone} onChange={(e) => setTone(e.target.value as 'info' | 'warning')} aria-label={t('Вид')}>
          <option value="info">{t('Новина (синьо)')}</option>
          <option value="warning">{t('Внимание (жълто)')}</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs text-mist-400">{t('От')}<input type="datetime-local" className="input w-auto py-1.5" value={start} onChange={(e) => setStart(e.target.value)} aria-label={t('Показва се от')} /></label>
        <select className="input w-36" value={hours} onChange={(e) => setHours(e.target.value)} aria-label={t('Колко дълго')}>
          {[1, 3, 6, 12, 24, 48, 72, 168].map((h) => <option key={h} value={h}>{h < 24 ? t('{0} ч', h) : h === 24 ? t('1 ден') : t('{0} дни', h / 24)}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={discord} onChange={(e) => setDiscord(e.target.checked)} />{t('И в Discord (обновления)')}</label>
      </div>
      <p className="text-xs text-mist-400">{t('Без начален час се показва веднага.')}</p>
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={busy || !text.trim()} onClick={() => send(text.trim())}>{start ? t('Планирай') : current ? t('Смени') : t('Покажи на всички')}</button>
        {current && <button className="btn-ghost" disabled={busy} onClick={() => send('')}>{t('Махни')}</button>}
      </div>
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
    </div>
  );
}
