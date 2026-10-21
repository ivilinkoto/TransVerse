'use client';

import { Megaphone, Wrench } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { money } from '@/lib/format';
import { ROADSIDE } from '@/lib/game/roadside';

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
      setMessage({ ok: true, text: type === 'roadsidePaid' ? `Пътната помощ идва — камионът тръгва ${Math.max(1, Math.round((r.savedMs ?? 0) / 60_000))} мин. по-рано.` : `Повика ${r.asked ?? 0} приятели и колеги.` });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 rounded-xl border border-amber-sig/30 bg-amber-sig/5 p-3 text-sm">
      <div className="font-semibold text-amber-sig">{note} — камионът стои</div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="btn-primary px-3 py-1.5 text-xs" disabled={busy} onClick={() => run('roadsidePaid')}>
          <Wrench className="h-3.5 w-3.5" />Платена пътна помощ · {money(ROADSIDE.paidCents)} (−{Math.round(ROADSIDE.paidCut * 100)}% от чакането)
        </button>
        <button type="button" className="btn-ghost px-3 py-1.5 text-xs" disabled={busy} onClick={() => run('callForHelp')}>
          <Megaphone className="h-3.5 w-3.5" />Повикай приятели и колеги
        </button>
      </div>
      {message && <p role={message.ok ? 'status' : 'alert'} className={`mt-2 ${message.ok ? 'text-profit' : 'text-loss'}`}>{message.text}</p>}
    </div>
  );
}
