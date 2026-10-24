'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { money } from '@/lib/format';
import { SHARES } from '@/lib/game/shares';
import { t, intlLocale } from '@/i18n/t';

function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/game/action', body);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export function ListCompanyButton() {
  const { busy, error, run } = useRun();
  return (
    <div className="mt-3">
      <button type="button" className="btn-primary" disabled={busy} onClick={() => void run({ type: 'listCompany' })}>{t('📈 Листни компанията')}</button>
      {error && <p role="alert" className="mt-1 text-sm text-loss">{error}</p>}
    </div>
  );
}

export function ShareTrade({ organizationId, priceCents, free, holding }: { organizationId: string; priceCents: number; free: number; holding: { shares: number; locked: boolean; lockedUntil: string } | null }) {
  const { busy, error, run } = useRun();
  const [count, setCount] = useState(10);
  const max = Math.max(0, Math.min(free, SHARES.perPlayerMax - (holding?.shares ?? 0)));
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <input type="number" className="input w-24" min={1} max={SHARES.perPlayerMax} value={count} onChange={(e) => setCount(Math.max(1, Math.floor(Number(e.target.value) || 1)))} aria-label={t('Брой акции')} />
      <button type="button" className="btn-primary px-3 py-1.5" disabled={busy || max < 1 || count > max} onClick={() => void run({ type: 'buyShares', organizationId, count })}>
        {t('Купи · {0}', money(Math.round(priceCents * count * (1 + SHARES.feeShare))))}
      </button>
      {holding && (
        <button type="button" className="btn-ghost px-3 py-1.5" disabled={busy || holding.locked || count > holding.shares} onClick={() => void run({ type: 'sellShares', organizationId, count })} title={holding.locked ? t('Продаваш след {0}', new Date(holding.lockedUntil).toLocaleString(intlLocale())) : undefined}>
          {t('Продай · {0}', money(Math.round(priceCents * Math.min(count, holding.shares) * SHARES.sellShare)))}
        </button>
      )}
      {holding?.locked && <span className="text-xs text-mist-400">{t('продажба след {0}', new Date(holding.lockedUntil).toLocaleDateString(intlLocale()))}</span>}
      {error && <span role="alert" className="text-loss">{error}</span>}
    </div>
  );
}
