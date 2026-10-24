'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { ASSEMBLY, DEPARTMENTS } from '@/lib/game/company-life';

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
      <input className="input min-w-0 flex-1" maxLength={DEPARTMENTS.nameMax} value={name} onChange={(e) => setName(e.target.value)} placeholder="Хладилен отдел" aria-label="Име на отдела" />
      <input type="number" className="input w-24" min={10} max={10000} value={goal} onChange={(e) => setGoal(Number(e.target.value) || DEPARTMENTS.defaultGoalTons)} aria-label="Цел в тонове за седмица" />
      <span className="text-xs text-mist-400">т / седмица</span>
      <button className="btn-primary" disabled={busy || name.trim().length < 2}>Нов отдел</button>
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
        <button type="button" className={`rounded-lg border px-2.5 py-1 text-xs ${kind === 'text' ? 'border-cyan-glow text-white' : 'border-asphalt-700 text-mist-300'}`} onClick={() => setKind('text')}>Свободен въпрос</button>
        <button type="button" className={`rounded-lg border px-2.5 py-1 text-xs ${kind === 'rate' ? 'border-cyan-glow text-white' : 'border-asphalt-700 text-mist-300'}`} onClick={() => setKind('rate')}>Вноска към касата</button>
      </div>
      <input className="input w-full" maxLength={ASSEMBLY.questionMax} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={kind === 'rate' ? 'колко да е вноската от всеки курс?' : 'Коя сграда строим следващата?'} aria-label="Въпрос" />
      {kind === 'text' ? (
        <input className="input w-full" value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Отговори, разделени със запетая (2–4): Склад, Бензиностанция, Музей" aria-label="Отговори" />
      ) : (
        <p className="text-xs text-mist-400">Отговорите са {ASSEMBLY.rateOptions.map((r) => `${Math.round(r * 100)} %`).join(', ')} — печелившият се прилага сам.</p>
      )}
      <button className="btn-primary" disabled={busy || question.trim().length < 5 || (kind === 'text' && (list.length < 2 || list.length > 4))}>Отвори гласуване ({ASSEMBLY.days} дни)</button>
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
      <input type="date" className="input" value={d} onChange={(e) => setD(e.target.value)} aria-label="Ден" />
      <input className="input min-w-0 flex-1" maxLength={40} value={n} onChange={(e) => setN(e.target.value)} placeholder="Ден на основаването" aria-label="Име на традицията" />
      <button className="btn-primary" disabled={busy || !d || n.trim().length < 2}>Запази</button>
      {day && <button type="button" className="btn-ghost" disabled={busy} onClick={() => void send({ type: 'tradition', day: null })}>Махни</button>}
      {error && <p role="alert" className="w-full text-loss">{error}</p>}
    </form>
  );
}
