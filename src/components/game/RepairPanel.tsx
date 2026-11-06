'use client';

import { Wrench } from 'lucide-react';
import { useState } from 'react';
import { ActionButton } from '@/components/ui/ActionButton';
import { money } from '@/lib/format';
import { REPAIR_SHARES, repairPlan, type RepairPart, type RepairUnit } from '@/lib/game/repair';
import { t } from '@/i18n/t';

/**
 * 1.2.3.1: the repair in the garage — the truck, the trailer or both, and how much of the
 * damage (or as much as the money allows). The prices here are a preview; the server decides.
 */
export function RepairPanel({ vehicleId, truck, trailer, factor, balanceCents, disabled }: { vehicleId: string; truck: RepairUnit; trailer: RepairUnit | null; factor: number; balanceCents: number; disabled?: boolean }) {
  const [part, setPart] = useState<RepairPart>('all');
  const [share, setShare] = useState<number>(100);
  const plan = repairPlan(truck, trailer, part, share, factor);
  const afford = repairPlan(truck, trailer, part, 100, factor, balanceCents);
  const full = repairPlan(truck, trailer, part, 100, factor).costCents;
  const parts: { id: RepairPart; label: string; damaged: boolean }[] = [
    { id: 'all', label: t('Всичко'), damaged: truck.condition < 100 || (!!trailer && trailer.condition < 100) },
    { id: 'truck', label: t('Камион'), damaged: truck.condition < 100 },
    ...(trailer ? [{ id: 'trailer' as const, label: t('Ремарке'), damaged: trailer.condition < 100 }] : []),
  ];
  const pct = (n: number) => `${Math.round(n)}%`;
  const result = [part !== 'trailer' && truck.condition < 100 ? t('камион {0} → {1}', pct(truck.condition), pct(plan.truckTo)) : null, trailer && part !== 'truck' && trailer.condition < 100 ? t('ремарке {0} → {1}', pct(trailer.condition), pct(plan.trailerTo!)) : null].filter(Boolean).join(' · ');
  const chip = (on: boolean) => `rounded-lg border px-2.5 py-1 text-xs ${on ? 'border-cyan-glow bg-cyan-glow/15 text-white' : 'border-asphalt-700 text-mist-300 hover:border-asphalt-600'}`;

  if (full <= 0 && part === 'all') return <ActionButton action={{ type: 'repairVehicle', vehicleId }} className="btn-primary" disabled><Wrench className="h-4 w-4" />{t('Ремонт · {0}', money(0))}</ActionButton>;
  return (
    <div className="w-full space-y-2 rounded-xl border border-asphalt-700 bg-asphalt-850 p-3 text-sm" data-testid="repair-panel">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="label mr-1">{t('Ремонтирай')}</span>
        {parts.map((p) => <button key={p.id} type="button" className={chip(part === p.id)} disabled={!p.damaged} onClick={() => setPart(p.id)} aria-pressed={part === p.id}>{p.label}</button>)}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="label mr-1">{t('Колко')}</span>
        {REPAIR_SHARES.map((s) => <button key={s} type="button" className={chip(share === s)} onClick={() => setShare(s)} aria-pressed={share === s}>{s === 100 ? t('Изцяло') : `${s}%`}</button>)}
      </div>
      {result && <p className="text-xs text-mist-400">{result}</p>}
      <div className="flex flex-wrap gap-2">
        <ActionButton action={{ type: 'repairVehicle', vehicleId, part, share }} className="btn-primary" disabled={disabled || plan.costCents <= 0 || plan.costCents > balanceCents}>
          <Wrench className="h-4 w-4" />{t('Ремонт · {0}', money(plan.costCents))}
        </ActionButton>
        {full > balanceCents && afford.costCents > 0 && (
          <ActionButton action={{ type: 'repairVehicle', vehicleId, part, afford: true }} className="btn-ghost" disabled={disabled}>
            {t('За колкото имам · {0}', money(afford.costCents))}
          </ActionButton>
        )}
      </div>
      {plan.costCents > balanceCents && <p className="text-xs text-loss">{t('Не стигат парите — избери по-малък ремонт или „За колкото имам“.')}</p>}
    </div>
  );
}
