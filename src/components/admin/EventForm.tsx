'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { t as tr, tx } from '@/i18n/t';

export interface MetricOption {
  id: string;
  label: string;
  unit: string;
  minContribution: number;
}
export interface TemplateOption {
  id: string;
  name: string;
  description: string;
  metric: string;
  cargoType: string | null;
  countryCode: string | null;
}
type Place = { eur: number; xp: number; coins: number; vipDays: number };

export function EventForm({ metrics, cargoTypes, countries, templates, defaults }: {
  metrics: MetricOption[];
  cargoTypes: { id: string; label: string }[];
  countries: { code: string; name: string }[];
  templates: TemplateOption[];
  defaults: { participant: { eur: number; xp: number; coins: number }; top: Place[] };
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', metric: 'tons', cargoType: '', countryCode: '', target: 1_000_000, minContribution: 5, startsAt: '', durationHours: 72 });
  const [participant, setParticipant] = useState(defaults.participant);
  const [top, setTop] = useState<Place[]>(defaults.top);
  const metric = metrics.find((m) => m.id === form.metric)!;
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const applyTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    const m = metrics.find((x) => x.id === t.metric)!;
    set({ name: t.name, description: t.description, metric: t.metric, cargoType: t.cargoType ?? '', countryCode: t.countryCode ?? '', minContribution: m.id === 'earned_cents' ? m.minContribution / 100 : m.minContribution });
  };
  const setPlaces = (n: number) => setTop((t) => (n <= t.length ? t.slice(0, n) : [...t, ...Array.from({ length: n - t.length }, () => ({ eur: 1000, xp: 100, coins: 10, vipDays: 0 }))]));
  const editPlace = (i: number, patch: Partial<Place>) => setTop((t) => t.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await api('/api/admin/action', {
        type: 'createEvent',
        event: {
          ...form,
          cargoType: form.cargoType || null,
          countryCode: form.countryCode || null,
          startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : undefined,
          participant,
          top,
          announce: (document.getElementById('event-announce') as HTMLInputElement | null)?.checked ?? true,
        },
      });
      setDone(true);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const field = 'mb-1.5 block text-sm font-medium text-mist-300';
  const num = (v: string) => (v === '' ? 0 : Number(v));
  return (
    <form onSubmit={submit} className="space-y-5">
      <label className="block max-w-md"><span className={field}>{tr('Готов шаблон (по избор)')}</span>
        <select className="input" defaultValue="" onChange={(e) => applyTemplate(e.target.value)}>
          <option value="">{tr('— попълни ръчно —')}</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{tx(t.name)}</option>)}
        </select>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block"><span className={field}>{tr('Име на ивента')}</span><input className="input" required minLength={3} maxLength={60} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder={tr('Великото преместване')} /></label>
        <label className="block"><span className={field}>{tr('Какво се брои')}</span>
          <select className="input" value={form.metric} onChange={(e) => set({ metric: e.target.value, minContribution: (() => { const m = metrics.find((x) => x.id === e.target.value)!; return m.id === 'earned_cents' ? m.minContribution / 100 : m.minContribution; })() })}>
            {metrics.map((m) => <option key={m.id} value={m.id}>{tx(m.label)} ({tx(m.unit)})</option>)}
          </select>
        </label>
        <label className="block sm:col-span-2"><span className={field}>{tr('Описание')}</span><textarea className="input min-h-20" maxLength={400} value={form.description} onChange={(e) => set({ description: e.target.value })} /></label>
        <label className="block"><span className={field}>{tr('Само товари от вид')}</span>
          <select className="input" value={form.cargoType} onChange={(e) => set({ cargoType: e.target.value })}><option value="">{tr('Всички')}</option>{cargoTypes.map((c) => <option key={c.id} value={c.id}>{tx(c.label)}</option>)}</select>
        </label>
        <label className="block"><span className={field}>{tr('Само маршрути през държава')}</span>
          <select className="input" value={form.countryCode} onChange={(e) => set({ countryCode: e.target.value })}><option value="">{tr('Всички')}</option>{countries.map((c) => <option key={c.code} value={c.code}>{tx(c.name)}</option>)}</select>
        </label>
        <label className="block"><span className={field}>{tr('Обща цел ({0})', tx(metric.unit))}</span><input className="input" type="number" min={1} step="any" required value={form.target} onChange={(e) => set({ target: num(e.target.value) })} /></label>
        <label className="block"><span className={field}>{tr('Минимален принос за участник ({0})', tx(metric.unit))}</span><input className="input" type="number" min={0} step="any" required value={form.minContribution} onChange={(e) => set({ minContribution: num(e.target.value) })} /></label>
        <label className="block"><span className={field}>{tr('Начало (празно = веднага)')}</span><input className="input" type="datetime-local" value={form.startsAt} onChange={(e) => set({ startsAt: e.target.value })} /></label>
        <label className="block"><span className={field}>{tr('Продължителност (часа)')}</span><input className="input" type="number" min={1} max={720} required value={form.durationHours} onChange={(e) => set({ durationHours: num(e.target.value) })} /></label>
      </div>

      <fieldset className="rounded-xl border border-asphalt-700 p-4">
        <legend className="px-1 text-sm font-semibold">{tr('Награда за всеки участник (само при постигната цел)')}</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block"><span className={field}>{tr('Пари (лв.)')}</span><input className="input" type="number" min={0} value={participant.eur} onChange={(e) => setParticipant({ ...participant, eur: num(e.target.value) })} /></label>
          <label className="block"><span className={field}>{tr('Опит')}</span><input className="input" type="number" min={0} value={participant.xp} onChange={(e) => setParticipant({ ...participant, xp: num(e.target.value) })} /></label>
          <label className="block"><span className={field}>{tr('ТрансКоин')}</span><input className="input" type="number" min={0} value={participant.coins} onChange={(e) => setParticipant({ ...participant, coins: num(e.target.value) })} /></label>
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-gold-400/30 p-4">
        <legend className="px-1 text-sm font-semibold text-gold-400">{tr('Допълнителни награди за най-добрите')}</legend>
        <label className="mb-3 flex items-center gap-2 text-sm">{tr('Брой награждавани места')}
          <select className="input w-24" value={top.length} onChange={(e) => setPlaces(Number(e.target.value))}>{Array.from({ length: 11 }, (_, i) => <option key={i} value={i}>{i}</option>)}</select>
        </label>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead><tr className="text-left text-xs text-mist-400"><th className="py-1 pr-2">{tr('Място')}</th><th className="pr-2">{tr('VIP (дни)')}</th><th className="pr-2">{tr('ТрансКоин')}</th><th className="pr-2">{tr('Пари (лв.)')}</th><th>{tr('Опит')}</th></tr></thead>
            <tbody>
              {top.map((p, i) => (
                <tr key={i}>
                  <td className="py-1 pr-2 font-semibold">{i + 1}</td>
                  <td className="pr-2"><input aria-label={tr('VIP дни за {0} място', i + 1)} className="input py-1" type="number" min={0} max={90} value={p.vipDays} onChange={(e) => editPlace(i, { vipDays: num(e.target.value) })} /></td>
                  <td className="pr-2"><input aria-label={tr('ТрансКоин за {0} място', i + 1)} className="input py-1" type="number" min={0} value={p.coins} onChange={(e) => editPlace(i, { coins: num(e.target.value) })} /></td>
                  <td className="pr-2"><input aria-label={tr('Пари за {0} място', i + 1)} className="input py-1" type="number" min={0} value={p.eur} onChange={(e) => editPlace(i, { eur: num(e.target.value) })} /></td>
                  <td><input aria-label={tr('Опит за {0} място', i + 1)} className="input py-1" type="number" min={0} value={p.xp} onChange={(e) => editPlace(i, { xp: num(e.target.value) })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-mist-400">{tr('Местата получават и наградата за участник. VIP се добавя към текущия срок на играча.')}</p>
      </fieldset>

      <label className="flex items-center gap-2 text-sm"><input id="event-announce" type="checkbox" defaultChecked />{tr('Изпрати известие до всички играчи')}</label>
      {error && <p role="alert" className="rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">{error}</p>}
      {done && <p role="status" className="text-sm text-profit">{tr('Ивентът е създаден.')}</p>}
      <button className="btn-gold" disabled={busy}>{busy ? tr('Създаване…') : tr('Създай ивент')}</button>
    </form>
  );
}
