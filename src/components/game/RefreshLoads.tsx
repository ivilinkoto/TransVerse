'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { BOARD_REFRESH } from '@/lib/game/board-refresh';
import { t, tx } from '@/i18n/t';

/** 1.2.3.4: new loads around the free trucks — free once a day, then for ТрансКоин that double. */
export function RefreshLoads({ price, freeAgainAt }: { price: number; freeAgainAt: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ created: number; paidCoins: number; perCity?: { city: string; count: number }[] }>('/api/game/action', { type: 'refreshLoads' });
      // 1.2.3.6: where the new loads came out, e.g. „Нови товари: 7 — София 3 · Пловдив 2 · Варна 2“.
      const where = (r.perCity ?? []).map((c) => `${tx(c.city)} ${c.count}`).join(' · ');
      setNote(r.created ? (where ? t('Нови товари: {0} — {1}', r.created, where) : t('Нови товари: {0}', r.created)) : t('Около камионите вече има достатъчно товари.'));
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const again = freeAgainAt ? new Date(freeAgainAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-asphalt-700 bg-asphalt-900/60 px-3 py-2 text-sm" data-testid="refresh-loads">
      <button type="button" className={price ? 'btn-ghost px-3 py-1.5 text-sm' : 'btn-primary px-3 py-1.5 text-sm'} disabled={busy} onClick={go}>
        {busy ? '…' : price ? t('🔄 Нови товари · {0} TC', price) : t('🔄 Нови товари · безплатно')}
      </button>
      <span className="text-xs text-mist-400">
        {price ? t('Безплатното обновяване е пак в {0}. Всяко следващо е двойно по-скъпо.', again ?? '') : t('По {0} нови товара около всеки град със свободен камион. Веднъж на 24 часа е безплатно.', BOARD_REFRESH.perCity)}
      </span>
      {note && <span className="text-xs text-profit" data-testid="refresh-loads-note">{note}</span>}
      {error && <span role="alert" className="text-xs text-loss">{error}</span>}
    </div>
  );
}
