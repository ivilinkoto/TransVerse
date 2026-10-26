'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { t, tx } from '@/i18n/t';

function useSubmit() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await fn();
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { error, saved, busy, run };
}

function Feedback({ error, saved, okText = t('Запазено.') }: { error: string | null; saved: boolean; okText?: string }) {
  if (error) return <p role="alert" className="rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">{error}</p>;
  if (saved) return <p role="status" className="text-sm text-profit">{okText}</p>;
  return null;
}

export function JoinCompanyForm({ companyId, mode, disabled }: { companyId: string; mode: 'open' | 'application'; disabled?: string | null }) {
  const [message, setMessage] = useState('');
  const { error, saved, busy, run } = useSubmit();
  if (disabled) return <p className="text-sm text-mist-400">{disabled}</p>;
  return (
    <div className="space-y-3">
      {mode === 'application' && (
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-mist-300">{t('Съобщение към компанията (по желание)')}</span>
          <textarea className="input min-h-24" maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('Здравейте! Карам редовно и търся екип.')} />
        </label>
      )}
      <button className="btn-gold w-full py-3" disabled={busy} onClick={() => run(() => api('/api/game/action', { type: 'joinCompany', companyId, message }))}>
        {busy ? '…' : mode === 'open' ? t('Присъедини се') : t('Изпрати кандидатура')}
      </button>
      <Feedback error={error} saved={saved} okText={mode === 'open' ? t('Добре дошли в компанията!') : t('Кандидатурата е изпратена.')} />
    </div>
  );
}

export function ProfileForm({ initial, tagUnlocked, colorUnlocked }: { initial: { description: string; rules: string; tag: string; color: string }; tagUnlocked: boolean; colorUnlocked: boolean }) {
  const [form, setForm] = useState(initial);
  const { error, saved, busy, run } = useSubmit();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    run(() => api('/api/game/action', { type: 'updateCompanyProfile', profile: { description: form.description, rules: form.rules, tag: tagUnlocked ? form.tag : '', color: colorUnlocked ? form.color : '' } }));
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-mist-300">{t('Описание')}</span>
        <textarea name="description" className="input min-h-32" maxLength={2000} value={form.description} onChange={set('description')} placeholder={t('Кои сме, какво возим, къде работим…')} />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-mist-300">{t('Правила на компанията')}</span>
        <textarea name="rules" className="input min-h-32" maxLength={4000} value={form.rules} onChange={set('rules')} placeholder={t('1. Доставяме навреме.\n2. Помагаме на новите шофьори.')} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-mist-300">{t('Таг')}{' '}{!tagUnlocked && <span className="text-mist-400">{t('· отключва се на ниво 5')}</span>}</span>
          <input name="tag" className="input uppercase" maxLength={5} value={form.tag} onChange={set('tag')} disabled={!tagUnlocked} placeholder={t('БЕКС')} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-mist-300">{t('Фирмен цвят')}{' '}{!colorUnlocked && <span className="text-mist-400">{t('· отключва се на ниво 3')}</span>}</span>
          <input name="color" type="color" className="input h-11 p-1" value={form.color || '#3b82f6'} onChange={set('color')} disabled={!colorUnlocked} />
        </label>
      </div>
      <Feedback error={error} saved={saved} />
      <button className="btn-primary" disabled={busy}>{busy ? t('Запазване…') : t('Запази профила')}</button>
    </form>
  );
}

export function AssetUpload({ kind, label, hint, locked, hasAsset }: { kind: 'logo' | 'banner'; label: string; hint: string; locked?: string | null; hasAsset: boolean }) {
  const { error, saved, busy, run } = useSubmit();
  const upload = (file: File) =>
    run(async () => {
      const body = new FormData();
      body.set('kind', kind);
      body.set('file', file);
      const response = await fetch('/api/company/asset', { method: 'POST', body, credentials: 'same-origin' });
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new Error(data.message ?? t('Качването не успя.'));
    });
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-mist-300">{label}</div>
      {locked ? (
        <p className="text-sm text-mist-400">{locked}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label className="btn-ghost cursor-pointer">
              {busy ? t('Качване…') : hasAsset ? t('Смени изображението') : t('Качи изображение')}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} aria-label={label} />
            </label>
            {hasAsset && (
              <button type="button" className="btn-ghost text-loss" disabled={busy} onClick={() => run(() => api('/api/game/action', { type: 'removeCompanyAsset', kind }))}>{t('Премахни')}</button>
            )}
          </div>
          <p className="text-xs text-mist-400">{hint}</p>
        </>
      )}
      <Feedback error={error} saved={saved} okText={t('Готово.')} />
    </div>
  );
}

export function SettingsForm({ initial, recruitmentOptions, maxRatePct }: { initial: { recruitment: string; minJoinLevel: number; contributionPct: number }; recruitmentOptions: { value: string; label: string }[]; maxRatePct: number }) {
  const [form, setForm] = useState(initial);
  const { error, saved, busy, run } = useSubmit();
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    run(() => api('/api/game/action', { type: 'updateCompanySettings', settings: { recruitment: form.recruitment, minJoinLevel: form.minJoinLevel, contributionRate: form.contributionPct / 100 } }));
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-mist-300">{t('Набиране на членове')}</span>
        <select name="recruitment" className="input" value={form.recruitment} onChange={(e) => setForm((f) => ({ ...f, recruitment: e.target.value }))}>
          {recruitmentOptions.map((o) => <option key={o.value} value={o.value}>{tx(o.label)}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-mist-300">{t('Минимално ниво за присъединяване')}</span>
        <input name="minJoinLevel" type="number" className="input" min={1} max={50} value={form.minJoinLevel} onChange={(e) => setForm((f) => ({ ...f, minJoinLevel: Number(e.target.value) }))} />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-mist-300">{t('Вноска на членовете към компанията:')}{' '}<span className="num text-mist-100">{tx(form.contributionPct)}%</span>{' '}{t('от възнаграждението за курс')}</span>
        <input name="contribution" type="range" className="w-full accent-[var(--color-gold-400)]" min={0} max={maxRatePct} step={1} value={form.contributionPct} onChange={(e) => setForm((f) => ({ ...f, contributionPct: Number(e.target.value) }))} />
      </label>
      <Feedback error={error} saved={saved} />
      <button className="btn-primary" disabled={busy}>{busy ? t('Запазване…') : t('Запази настройките')}</button>
    </form>
  );
}

export interface RankFormValue {
  id?: string;
  name: string;
  priority: number;
  permissions: string[];
  isOwner?: boolean;
}

export function RankForm({ rank, permissions, grantable, minPriority, submitLabel }: { rank: RankFormValue; permissions: { key: string; label: string }[]; grantable: string[]; minPriority: number; submitLabel: string }) {
  const [form, setForm] = useState(rank);
  const { error, saved, busy, run } = useSubmit();
  const toggle = (key: string) => setForm((f) => ({ ...f, permissions: f.permissions.includes(key) ? f.permissions.filter((p) => p !== key) : [...f.permissions, key] }));
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const payload = { name: form.name, priority: form.priority, permissions: form.permissions };
    run(() => api('/api/game/action', rank.id ? { type: 'updateRank', rankId: rank.id, rank: payload } : { type: 'createRank', rank: payload }));
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-mist-400">{t('Име')}</span>
          <input className="input" required minLength={2} maxLength={32} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-mist-400">{t('Старшинство')}</span>
          <input className="input" type="number" min={minPriority} max={999} value={form.priority} disabled={rank.isOwner} onChange={(e) => setForm((f) => ({ ...f, priority: Number(e.target.value) }))} title={t('По-малко число = по-висока длъжност')} />
        </label>
      </div>
      {!rank.isOwner && (
        <fieldset className="grid gap-1.5">
          <legend className="mb-1 text-xs font-medium text-mist-400">{t('Права')}</legend>
          {permissions.map((p) => (
            <label key={p.key} className={`flex items-start gap-2 text-sm ${grantable.includes(p.key) ? '' : 'opacity-50'}`}>
              <input type="checkbox" className="mt-1" checked={form.permissions.includes(p.key)} disabled={!grantable.includes(p.key)} onChange={() => toggle(p.key)} />
              <span>{tx(p.label)}</span>
            </label>
          ))}
        </fieldset>
      )}
      <Feedback error={error} saved={saved} />
      <button className="btn-primary py-2 text-sm" disabled={busy}>{busy ? '…' : submitLabel}</button>
    </form>
  );
}

export function DepositForm() {
  const [amount, setAmount] = useState('');
  const { error, saved, busy, run } = useSubmit();
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    run(async () => {
      await api('/api/game/action', { type: 'depositTreasury', amountEur: Number(amount) });
      setAmount('');
    });
  };
  return (
    <form onSubmit={submit} className="space-y-2">
      <label className="block text-sm font-medium text-mist-300" htmlFor="deposit">{t('Внеси от личните си пари')}</label>
      <div className="flex gap-2">
        <input id="deposit" name="deposit" type="number" min={1} step={1} inputMode="numeric" className="input min-w-0 flex-1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t('Сума в лв.')} required />
        <button className="btn-gold" disabled={busy || !amount}>{busy ? '…' : t('Внеси')}</button>
      </div>
      <Feedback error={error} saved={saved} okText={t('Внесено в касата.')} />
    </form>
  );
}

/** Owner hands the company over to a member, optionally leaving it right away. */
export function TransferOwnershipForm({ members }: { members: { userId: string; label: string }[] }) {
  const [target, setTarget] = useState(members[0]?.userId ?? '');
  const [leave, setLeave] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { error, busy, run } = useSubmit();
  if (!members.length) return <p className="text-sm text-mist-400">{t('В компанията няма други членове, на които да предадете собствеността.')}</p>;
  const name = members.find((m) => m.userId === target)?.label ?? '';
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-mist-300">{t('Нов собственик')}</span>
        <select className="input" value={target} onChange={(e) => { setTarget(e.target.value); setConfirming(false); }} aria-label={t('Нов собственик')}>
          {members.map((m) => <option key={m.userId} value={m.userId}>{tx(m.label)}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={leave} onChange={(e) => setLeave(e.target.checked)} />
        {t('Напускам компанията след предаването')}
      </label>
      {confirming ? (
        <div className="space-y-2 rounded-xl border border-loss/40 bg-loss/10 p-3 text-sm">
          <p>{t('Предавате „{0}“ всички права на собственик{1}. Това не може да се отмени от вас.', name, leave ? t(' и напускате компанията') : t(' и ставате заместник'))}</p>
          <div className="flex gap-2">
            <button className="btn-danger" disabled={busy} onClick={() => run(() => api('/api/game/action', { type: 'transferOwnership', userId: target, leave }))}>{busy ? '…' : t('Потвърди')}</button>
            <button className="btn-ghost" onClick={() => setConfirming(false)}>{t('Отказ')}</button>
          </div>
        </div>
      ) : (
        <button className="btn-primary" onClick={() => setConfirming(true)} disabled={!target}>{t('Предай собствеността')}</button>
      )}
      <Feedback error={error} saved={false} />
    </div>
  );
}
