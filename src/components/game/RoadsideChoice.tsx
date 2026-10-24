'use client';

import { Megaphone, Wrench } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { money } from '@/lib/format';
import { ROADSIDE } from '@/lib/game/roadside';
import { t, tx } from '@/i18n/t';

/** The own truck stands after a breakdown, ice, snow or a closed pass: paid assistance or call the colleagues. */
export function RoadsideChoice({ deliveryId, note }: { deliveryId: string; note: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (type: 'roadsidePaid' | 'callForHelp') => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api<{ savedMs?: number; asked?: number }>('/api/game/action', { type, deliveryId });
      setMessage({ ok: true, text: type === 'roadsidePaid' ? t('Пътната помощ идва — камионът тръгва {0} мин. по-рано.', Math.max(1, Math.round((r.savedMs ?? 0) / 60_000))) : t('Повика {0} приятели и колеги.', r.asked ?? 0) });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 rounded-xl border border-amber-sig/30 bg-amber-sig/5 p-3 text-sm">
      <div className="font-semibold text-amber-sig">{t('{0} — камионът стои', note)}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="btn-primary px-3 py-1.5 text-xs" disabled={busy} onClick={() => run('roadsidePaid')}>
          <Wrench className="h-3.5 w-3.5" />{t('Платена пътна помощ · {0} (−{1}% от чакането)', money(ROADSIDE.paidCents), Math.round(ROADSIDE.paidCut * 100))}
        </button>
        <button type="button" className="btn-ghost px-3 py-1.5 text-xs" disabled={busy} onClick={() => run('callForHelp')}>
          <Megaphone className="h-3.5 w-3.5" />{t('Повикай приятели и колеги')}
        </button>
      </div>
      {message && <p role={message.ok ? 'status' : 'alert'} className={`mt-2 ${message.ok ? 'text-profit' : 'text-loss'}`}>{tx(message.text)}</p>}
    </div>
  );
}
