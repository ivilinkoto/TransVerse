'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { ASSEMBLY, DEPARTMENTS } from '@/lib/game/company-life';
import { t } from '@/i18n/t';

function useSend() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/game/action', body);
      router.refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, send };
}

export function NewDepartment() {
  const { busy, error, send } = useSend();
  const [name, setName] = useState('');
  const [goal, setGoal] = useState<number>(DEPARTMENTS.defaultGoalTons);
  return (
    <form className="flex flex-wrap items-center gap-2 text-sm" onSubmit={async (e) => { e.preventDefault(); if (await send({ type: 'createDepartment', name, goalTons: goal })) setName(''); }}>
      <input className="input min-w-0 flex-1" maxLength={DEPARTMENTS.nameMax} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Хладилен отдел')} aria-label={t('Име на отдела')} />
      <input type="number" className="input w-24" min={10} max={10000} value={goal} onChange={(e) => setGoal(Number(e.target.value) || DEPARTMENTS.defaultGoalTons)} aria-label={t('Цел в тонове за седмица')} />
      <span className="text-xs text-mist-400">{t('т / седмица')}</span>
      <button className="btn-primary" disabled={busy || name.trim().length < 2}>{t('Нов отдел')}</button>
      {error && <p role="alert" className="w-full text-loss">{error}</p>}
    </form>
  );
}

export function NewAssembly() {
  const { busy, error, send } = useSend();
  const [kind, setKind] = useState<'text' | 'rate'>('text');
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState('');
  const list = options.split(',').map((o) => o.trim()).filter(Boolean);
  return (
    <form className="space-y-2 text-sm" onSubmit={async (e) => { e.preventDefault(); if (await send({ type: 'openAssembly', kind, question, options: kind === 'text' ? list : undefined })) { setQuestion(''); setOptions(''); } }}>
      <div className="flex gap-2">
        <button type="button" className={`rounded-lg border px-2.5 py-1 text-xs ${kind === 'text' ? 'border-cyan-glow text-white' : 'border-asphalt-700 text-mist-300'}`} onClick={() => setKind('text')}>{t('Свободен въпрос')}</button>
        <button type="button" className={`rounded-lg border px-2.5 py-1 text-xs ${kind === 'rate' ? 'border-cyan-glow text-white' : 'border-asphalt-700 text-mist-300'}`} onClick={() => setKind('rate')}>{t('Вноска към касата')}</button>
      </div>
      <input className="input w-full" maxLength={ASSEMBLY.questionMax} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={kind === 'rate' ? t('колко да е вноската от всеки курс?') : t('Коя сграда строим следващата?')} aria-label={t('Въпрос')} />
      {kind === 'text' ? (
        <input className="input w-full" value={options} onChange={(e) => setOptions(e.target.value)} placeholder={t('Отговори, разделени със запетая (2–4): Склад, Бензиностанция, Музей')} aria-label={t('Отговори')} />
      ) : (
        <p className="text-xs text-mist-400">{t('Отговорите са')}{' '}{ASSEMBLY.rateOptions.map((r) => `${Math.round(r * 100)} %`).join(', ')}{' '}{t('— печелившият се прилага сам.')}</p>
      )}
      <button className="btn-primary" disabled={busy || question.trim().length < 5 || (kind === 'text' && (list.length < 2 || list.length > 4))}>{t('Отвори гласуване ({0} дни)', ASSEMBLY.days)}</button>
      {error && <p role="alert" className="text-loss">{error}</p>}
    </form>
  );
}

export function TraditionForm({ day, name }: { day: string | null; name: string | null }) {
  const { busy, error, send } = useSend();
  const [d, setD] = useState(day ? `2027-${day}` : '');
  const [n, setN] = useState(name ?? '');
  return (
    <form className="flex flex-wrap items-center gap-2 text-sm" onSubmit={(e) => { e.preventDefault(); void send({ type: 'tradition', day: d ? d.slice(5) : null, name: n }); }}>
      <input type="date" className="input" value={d} onChange={(e) => setD(e.target.value)} aria-label={t('Ден')} />
      <input className="input min-w-0 flex-1" maxLength={40} value={n} onChange={(e) => setN(e.target.value)} placeholder={t('Ден на основаването')} aria-label={t('Име на традицията')} />
      <button className="btn-primary" disabled={busy || !d || n.trim().length < 2}>{t('Запази')}</button>
      {day && <button type="button" className="btn-ghost" disabled={busy} onClick={() => void send({ type: 'tradition', day: null })}>{t('Махни')}</button>}
      {error && <p role="alert" className="w-full text-loss">{error}</p>}
    </form>
  );
}
