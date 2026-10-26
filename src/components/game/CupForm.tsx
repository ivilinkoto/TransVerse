'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { CUP_METRIC_LABELS, CUP_METRICS, CUPS, type CupMetric } from '@/lib/game/community-cups';
import { t, tx } from '@/i18n/t';

/** v2.0: the organiser's form for a new community tournament. */
export function CupForm({ cargo, countries, defaultStart }: { cargo: { id: string; label: string }[]; countries: { code: string; name: string }[]; defaultStart: string }) {
  const router = useRouter();
  const [f, setF] = useState({ name: '', description: '', metric: 'tons' as CupMetric, cargoType: '', countryCode: '', startsAt: defaultStart, days: 3, prizeEur: 5_000, feeEur: 0, maxPlayers: 20 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string | number) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const startsAt = new Date(f.startsAt);
      const endsAt = new Date(startsAt.getTime() + f.days * 86_400_000);
      const r = await api<{ id: string }>('/api/game/action', { type: 'cupCreate', name: f.name, description: f.description, metric: f.metric, cargoType: f.cargoType || null, countryCode: f.countryCode || null, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), prizeEur: f.prizeEur, feeEur: f.feeEur, maxPlayers: f.maxPlayers });
      router.push(`/game/cups/${r.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const field = 'block space-y-1 text-sm';
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <label className={field}><span className="text-mist-300">{t('Име')}</span><input className="input py-2" value={f.name} maxLength={CUPS.nameMax} onChange={(e) => set('name', e.target.value)} required /></label>
      <label className={field}><span className="text-mist-300">{t('Мярка')}</span>
        <select className="input py-2" value={f.metric} onChange={(e) => set('metric', e.target.value)}>{CUP_METRICS.map((m) => <option key={m} value={m}>{tx(CUP_METRIC_LABELS[m])}</option>)}</select>
      </label>
      <label className={`${field} sm:col-span-2`}><span className="text-mist-300">{t('Описание')}</span><textarea className="input py-2" rows={2} maxLength={CUPS.textMax} value={f.description} onChange={(e) => set('description', e.target.value)} /></label>
      <label className={field}><span className="text-mist-300">{t('Само товар')}</span>
        <select className="input py-2" value={f.cargoType} onChange={(e) => set('cargoType', e.target.value)}><option value="">{t('всякакъв')}</option>{cargo.map((c) => <option key={c.id} value={c.id}>{tx(c.label)}</option>)}</select>
      </label>
      <label className={field}><span className="text-mist-300">{t('Само до държава')}</span>
        <select className="input py-2" value={f.countryCode} onChange={(e) => set('countryCode', e.target.value)}><option value="">{t('всяка')}</option>{countries.map((c) => <option key={c.code} value={c.code}>{tx(c.name)}</option>)}</select>
      </label>
      <label className={field}><span className="text-mist-300">{t('Начало на турнира')}</span><input type="datetime-local" className="input py-2" value={f.startsAt} onChange={(e) => set('startsAt', e.target.value)} required /></label>
      <label className={field}><span className="text-mist-300">{t('Дни')}</span><input type="number" className="input py-2" min={1} max={CUPS.maxDays} value={f.days} onChange={(e) => set('days', Number(e.target.value))} /></label>
      <label className={field}><span className="text-mist-300">{t('Награда (лв.) от твоята сметка')}</span><input type="number" className="input py-2" min={CUPS.minPrizeCents / 100} max={CUPS.maxPrizeCents / 100} value={f.prizeEur} onChange={(e) => set('prizeEur', Number(e.target.value))} /></label>
      <label className={field}><span className="text-mist-300">{t('Такса за участие (лв.)')}</span><input type="number" className="input py-2" min={0} max={CUPS.maxFeeCents / 100} value={f.feeEur} onChange={(e) => set('feeEur', Number(e.target.value))} /></label>
      <label className={field}><span className="text-mist-300">{t('Най-много играчи')}</span><input type="number" className="input py-2" min={CUPS.minPlayers} max={CUPS.maxPlayers} value={f.maxPlayers} onChange={(e) => set('maxPlayers', Number(e.target.value))} /></label>
      <div className="flex items-end"><button className="btn-primary" disabled={busy || !f.name.trim()}>{busy ? '…' : t('Организирай турнира')}</button></div>
      {error && <p className="text-sm text-loss sm:col-span-2">{tx(error)}</p>}
    </form>
  );
}
