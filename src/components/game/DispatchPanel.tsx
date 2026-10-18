'use client';

import { ArrowRight, Sparkles, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { duration, money } from '@/lib/format';
import type { DispatchProposal } from '@/server/game/dispatch';

/** "Изпрати всички свободни": the server proposes a job for every free truck, the player confirms. */
export function DispatchPanel({ freeTrucks }: { freeTrucks: number }) {
  const router = useRouter();
  const [plan, setPlan] = useState<DispatchProposal[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api<{ plan: DispatchProposal[] }>('/api/game/action', { type: 'dispatchPlan' });
      setPlan(res.plan);
      setChosen(new Set(res.plan.map((p) => p.vehicleId)));
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const res = await api<{ sent: number; failed: { vehicleId: string; reason: string }[] }>('/api/game/action', { type: 'dispatchRun', plan: plan.filter((p) => chosen.has(p.vehicleId)).map((p) => ({ vehicleId: p.vehicleId, contractId: p.contractId })) });
      setPlan(null);
      setMessage(`Изпратени: ${res.sent}.${res.failed.length ? ` Не тръгнаха: ${res.failed.length} (${res.failed[0]!.reason})` : ''}`);
      router.refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const toggle = (id: string) => setChosen((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const total = plan?.filter((p) => chosen.has(p.vehicleId)).reduce((s, p) => s + p.profitCents, 0) ?? 0;

  return (
    <div className="panel mb-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-gold-400" />Диспечер</div>
          <p className="text-sm text-mist-400">{freeTrucks ? `Избира най-изгодната поръчка за всеки от свободните ти камиони (${freeTrucks}), която ще стигне навреме.` : 'Нямаш свободни камиони в момента.'}</p>
        </div>
        {!plan && <button type="button" className="btn-gold" disabled={busy || !freeTrucks} onClick={load}>{busy ? 'Търся…' : 'Предложи курсове'}</button>}
        {plan && <button type="button" className="btn-ghost px-2" onClick={() => setPlan(null)} aria-label="Затвори"><X className="h-4 w-4" /></button>}
      </div>
      {plan && (
        plan.length === 0 ? (
          <p className="mt-3 text-sm text-mist-300">Няма подходящи поръчки за свободните камиони точно сега — опитай по-късно или виж борсата.</p>
        ) : (
          <div className="mt-3 space-y-2">
            <ul className="divide-y divide-asphalt-800 rounded-xl border border-asphalt-700">
              {plan.map((p) => (
                <li key={p.vehicleId}>
                  <label className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                    <input type="checkbox" checked={chosen.has(p.vehicleId)} onChange={() => toggle(p.vehicleId)} />
                    <span className="font-mono text-xs text-mist-400">{p.plate}</span>
                    <span className="min-w-0 flex-1 truncate"><span className="font-medium">{p.goods}</span> · {p.from} <ArrowRight className="inline h-3 w-3" /> {p.to}</span>
                    <span className="num text-xs text-mist-400">≈ {duration(p.minutes)}</span>
                    <span className="num font-semibold text-profit">{money(p.profitCents)}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-mist-300">Очаквана печалба: <span className="num font-semibold text-profit">{money(total)}</span> <span className="text-xs text-mist-400">(оценка)</span></span>
              <button type="button" className="btn-primary" disabled={busy || chosen.size === 0} onClick={send}>{busy ? 'Изпращане…' : `Изпрати ${chosen.size}`}</button>
            </div>
          </div>
        )
      )}
      {message && <p role="status" className="mt-2 text-sm text-mist-300">{message}</p>}
    </div>
  );
}
