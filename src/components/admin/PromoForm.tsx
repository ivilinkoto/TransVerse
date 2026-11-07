'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { ITEMS, ITEM_IDS, type ItemId } from '@/lib/game/items';
import { PROMO } from '@/lib/game/promo';
import { t, tx } from '@/i18n/t';

/** 1.1.4.3: an administrator makes a public code or a batch of single-use codes. */
export function PromoForm() {
  const router = useRouter();
  const [mode, setMode] = useState<'public' | 'batch'>('public');
  const [code, setCode] = useState('');
  const [prefix, setPrefix] = useState('TV');
  const [count, setCount] = useState('20');
  const [coins, setCoins] = useState('');
  const [money, setMoney] = useState('');
  const [vip, setVip] = useState('');
  // Several items in one code (up to PROMO.maxItems kinds), e.g. a case and two coffees.
  const [rows, setRows] = useState<{ itemId: ItemId | ''; qty: string }[]>([{ itemId: '', qty: '1' }]);
  const setRow = (i: number, patch: Partial<{ itemId: ItemId | ''; qty: string }>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const picked = rows.filter((r) => r.itemId);
  const twice = new Set(picked.map((r) => r.itemId)).size !== picked.length;
  const [maxUses, setMaxUses] = useState('');
  const [minLevel, setMinLevel] = useState('1');
  const [endsAt, setEndsAt] = useState('');
  const [oldOnly, setOldOnly] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<string[] | null>(null);
  const items = ITEM_IDS.filter((id) => ITEMS[id].kind !== 'coins');

  const run = async () => {
    setBusy(true);
    setError(null);
    setMade(null);
    const promo = {
      reward: {
        ...(Number(coins) ? { coins: Number(coins) } : {}),
        ...(Number(money) ? { cents: Math.round(Number(money) * 100) } : {}),
        ...(Number(vip) ? { vipDays: Number(vip) } : {}),
        ...(picked.length ? { items: picked.map((r) => ({ itemId: r.itemId, qty: Number(r.qty) || 1 })) } : {}),
      },
      minLevel: Number(minLevel) || 1,
      endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      // „Only players who exist now“: a new account made for the code gets nothing.
      accountsBefore: oldOnly ? new Date().toISOString() : null,
      note,
    };
    try {
      if (mode === 'public') {
        const r = await api<{ code: string }>('/api/admin/action', { type: 'promoCreate', promo: { ...promo, code, maxUses: Number(maxUses) || null } });
        setMade([r.code]);
      } else {
        const r = await api<{ codes: string[] }>('/api/admin/action', { type: 'promoBatch', promo: { ...promo, count: Number(count), prefix } });
        setMade(r.codes);
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 text-sm">
      <div className="flex gap-2" role="radiogroup" aria-label={t('Вид код')}>
        <button type="button" className={mode === 'public' ? 'btn-primary' : 'btn-ghost'} aria-pressed={mode === 'public'} onClick={() => setMode('public')}>{t('Общ код')}</button>
        <button type="button" className={mode === 'batch' ? 'btn-primary' : 'btn-ghost'} aria-pressed={mode === 'batch'} onClick={() => setMode('batch')}>{t('Еднократни кодове')}</button>
      </div>
      {mode === 'public' ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1"><span className="label">{t('Код (празно — случаен)')}</span><input className="input w-full uppercase" value={code} onChange={(e) => setCode(e.target.value)} placeholder="BUDITELI2026" maxLength={32} /></label>
          <label className="space-y-1"><span className="label">{t('Най-много използвания (празно — без лимит)')}</span><input className="input w-full" type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} /></label>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1"><span className="label">{t('Представка')}</span><input className="input w-full uppercase" value={prefix} onChange={(e) => setPrefix(e.target.value)} maxLength={12} /></label>
          <label className="space-y-1"><span className="label">{t('Брой кодове (до {0})', PROMO.maxBatch)}</span><input className="input w-full" type="number" min={1} max={PROMO.maxBatch} value={count} onChange={(e) => setCount(e.target.value)} /></label>
        </div>
      )}
      <fieldset className="grid gap-2 sm:grid-cols-3">
        <legend className="label mb-1">{t('Награда')}</legend>
        <label className="space-y-1"><span className="text-xs text-mist-400">{t('ТрансКоин (до {0})', PROMO.maxCoins)}</span><input className="input w-full" type="number" min={0} max={PROMO.maxCoins} value={coins} onChange={(e) => setCoins(e.target.value)} /></label>
        <label className="space-y-1"><span className="text-xs text-mist-400">{t('Пари в играта, лв.')}</span><input className="input w-full" type="number" min={0} value={money} onChange={(e) => setMoney(e.target.value)} /></label>
        <label className="space-y-1"><span className="text-xs text-mist-400">{t('VIP дни (до {0})', PROMO.maxVipDays)}</span><input className="input w-full" type="number" min={0} max={PROMO.maxVipDays} value={vip} onChange={(e) => setVip(e.target.value)} /></label>
        <div className="space-y-2 sm:col-span-3" data-testid="promo-items">
          <span className="text-xs text-mist-400">{t('Кейсове и предмети (до {0} вида)', PROMO.maxItems)}</span>
          {rows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select className="input min-w-0 flex-1" value={r.itemId} onChange={(e) => setRow(i, { itemId: e.target.value as ItemId | '' })} aria-label={t('Предмет {0}', i + 1)}>
                <option value="">{t('— без —')}</option>
                {items.map((id) => <option key={id} value={id}>{tx(ITEMS[id].name)}</option>)}
              </select>
              <input className="input w-20" type="number" min={1} max={PROMO.maxItemQty} value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value })} disabled={!r.itemId} aria-label={t('Брой')} />
              {rows.length > 1 && <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setRows((all) => all.filter((_, j) => j !== i))} aria-label={t('Махни реда')}>✕</button>}
            </div>
          ))}
          {rows.length < PROMO.maxItems && <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => setRows((all) => [...all, { itemId: '', qty: '1' }])}>{t('+ Още предмет')}</button>}
          {twice && <p className="text-xs text-amber-sig">{t('Един предмет е избран два пъти — събери го в един ред с по-голям брой.')}</p>}
        </div>
      </fieldset>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1"><span className="label">{t('Важи до (празно — без край)')}</span><input className="input w-full" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></label>
        <label className="space-y-1"><span className="label">{t('Най-малко ниво')}</span><input className="input w-full" type="number" min={1} value={minLevel} onChange={(e) => setMinLevel(e.target.value)} /></label>
      </div>
      <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={oldOnly} onChange={(e) => setOldOnly(e.target.checked)} /><span>{t('Само за профили, които вече съществуват (нов профил, направен за кода, не получава нищо)')}</span></label>
      <input className="input w-full" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Бележка за екипа (напр. Facebook, Ден на будителите)')} maxLength={200} />
      <button type="button" className="btn-gold" disabled={busy || twice} onClick={run}>{busy ? '…' : mode === 'public' ? t('Създай кода') : t('Създай {0} кода', Number(count) || 0)}</button>
      {error && <p role="alert" className="text-loss">{error}</p>}
      {made && (
        <div className="space-y-2 rounded-xl border border-profit/40 bg-profit/10 p-3">
          <p className="font-semibold text-profit">{made.length === 1 ? t('Кодът е готов:') : t('Готови кодове: {0}', made.length)}</p>
          <textarea readOnly className="input num h-32 w-full font-mono text-xs" value={made.join('\n')} onFocus={(e) => e.currentTarget.select()} aria-label={t('Кодове')} />
          <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => void navigator.clipboard?.writeText(made.join('\n'))}>{t('Копирай')}</button>
        </div>
      )}
    </div>
  );
}
