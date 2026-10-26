'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { money } from '@/lib/format';
import { LOAN, loanTerms } from '@/lib/game/business';
import { t } from '@/i18n/t';

/** Takes a bank loan: the amount, the term and what it costs (v1.4). */
export function LoanForm({ maxCents, rateBps }: { maxCents: number; rateBps: number }) {
  const router = useRouter();
  const [amount, setAmount] = useState(Math.min(20_000, Math.floor(maxCents / 100)));
  const [weeks, setWeeks] = useState<number>(LOAN.weeksOptions[1]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const terms = loanTerms(amount * 100, rateBps, weeks);
  const take = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/game/action', { type: 'takeLoan', amountEur: amount, weeks });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 text-sm">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <input className="input" type="number" min={1_000} max={maxCents / 100} step={1_000} value={amount} onChange={(e) => setAmount(Number(e.target.value))} aria-label={t('Сума (лв.)')} />
        <select className="input" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} aria-label={t('Срок')}>
          {LOAN.weeksOptions.map((w) => <option key={w} value={w}>{t('{0} седмици', w)}</option>)}
        </select>
        <button type="button" className="btn-primary" disabled={busy || amount < 1_000 || amount * 100 > maxCents} onClick={take}>{t('Вземи кредита')}</button>
      </div>
      <p className="text-xs text-mist-400">{t('Връщаш {0} на {1} седмични вноски по {2}. Вноските се теглят сами; без пари вноската е пропусната и рейтингът пада.', money(terms.totalCents), weeks, money(terms.weeklyCents))}</p>
      {error && <p role="alert" className="text-loss">{error}</p>}
    </div>
  );
}
