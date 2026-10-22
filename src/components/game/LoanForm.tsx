'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { money } from '@/lib/format';
import { LOAN, loanTerms } from '@/lib/game/business';

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
        <input className="input" type="number" min={1_000} max={maxCents / 100} step={1_000} value={amount} onChange={(e) => setAmount(Number(e.target.value))} aria-label="Сума (лв.)" />
        <select className="input" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} aria-label="Срок">
          {LOAN.weeksOptions.map((w) => <option key={w} value={w}>{w} седмици</option>)}
        </select>
        <button type="button" className="btn-primary" disabled={busy || amount < 1_000 || amount * 100 > maxCents} onClick={take}>Вземи кредита</button>
      </div>
      <p className="text-xs text-mist-400">Връщаш {money(terms.totalCents)} на {weeks} седмични вноски по {money(terms.weeklyCents)}. Вноските се теглят сами; без пари вноската е пропусната и рейтингът пада.</p>
      {error && <p role="alert" className="text-loss">{error}</p>}
    </div>
  );
}
