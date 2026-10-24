'use client';

import { Tag } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { money } from '@/lib/format';
import { t } from '@/i18n/t';

/** "Обяви на пазара": price within the allowed range, with what the seller gets after the commission. */
export function ListForSale({ kind, itemId, bounds, feeShare, small = false, disabled = false }: { kind: 'vehicle' | 'trailer'; itemId: string; bounds: { min: number; max: number; suggested: number; resale: number }; feeShare: number; small?: boolean; disabled?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [eur, setEur] = useState(Math.round(bounds.suggested / 100));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cents = eur * 100;
  const valid = Number.isFinite(eur) && cents >= bounds.min && cents <= bounds.max;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/game/action', { type: 'listUsed', kind, itemId, priceEur: eur });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!open)
    return (
      <button type="button" className={`btn-ghost ${small ? 'px-3 py-1.5 text-xs' : ''}`} onClick={() => setOpen(true)} disabled={disabled}>
        <Tag className="h-4 w-4" />{t('Обяви на пазара')}
      </button>
    );
  return (
    <div className="w-full space-y-2 rounded-xl border border-cyan-glow/30 bg-cyan-glow/5 p-3 text-sm">
      <label className="block">
        <span className="label">{t('Цена за другите играчи (лв.)')}</span>
        <input type="number" inputMode="numeric" className="input mt-1" min={bounds.min / 100} max={bounds.max / 100} step={100} value={Number.isFinite(eur) ? eur : ''} onChange={(e) => setEur(Math.round(Number(e.target.value)))} />
      </label>
      <p className="text-xs text-mist-400">
        {t('Разрешено: {0} – {1} · веднага от търговец: {2}', money(bounds.min), money(bounds.max), money(bounds.resale))}
        {valid && <>{' '}{t('· получаваш')}{' '}<span className="font-semibold text-profit">{money(Math.round(cents * (1 - feeShare)))}</span>{' '}{t('след {0}% такса', Math.round(feeShare * 100))}</>}
      </p>
      {error && <p className="text-xs text-loss">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={() => void submit()} disabled={!valid || busy}>{busy ? t('Публикуване…') : t('Публикувай обявата')}</button>
        <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setOpen(false)}>{t('Отказ')}</button>
      </div>
    </div>
  );
}
