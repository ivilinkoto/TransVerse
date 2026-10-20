'use client';

import { Truck } from 'lucide-react';
import { useState } from 'react';
import { ActionButton } from '@/components/ui/ActionButton';
import { money } from '@/lib/format';
import { POWER_UNITS } from '@/lib/game/catalog';
import { COMPANY_FLEET } from '@/lib/game/company-fleet';

export interface OrgFleet {
  limit: number;
  vehicles: { id: string; name: string; plate: string; city: string; condition: number; odometerKm: number; borrower: string | null; lentTo: string | null }[];
}

const MODELS = POWER_UNITS.filter((m) => COMPANY_FLEET.kinds.includes(m.kind));

/** The company's own trucks: members borrow one, ranks with "Развитие" buy and sell them from the treasury. */
export function CompanyFleetCard({ fleet, me, myVehicleId, canManage, treasuryCents }: { fleet: OrgFleet; me: string; myVehicleId: string | null; canManage: boolean; treasuryCents: number }) {
  const [modelId, setModelId] = useState(MODELS[0]?.id ?? '');
  const model = MODELS.find((m) => m.id === modelId);
  return (
    <div className="panel p-4 text-sm">
      <h3 className="flex items-center gap-2 font-display text-lg font-bold"><Truck className="h-5 w-5 text-cyan-glow" />Фирмени камиони <span className="text-xs font-normal text-mist-400">{fleet.vehicles.length} / {fleet.limit}</span></h3>
      <p className="mt-1 text-mist-300">Камиони на компанията, купени от касата. Всеки член може да вземе един за курсове — горивото и ремонтите са негови — и после да го върне.</p>
      {fleet.limit === 0 && <p className="mt-2 text-xs text-mist-400">Нужен е паркинг на участъка: всяко ниво дава {COMPANY_FLEET.perParkingLevel} места за фирмени камиони.</p>}
      {fleet.vehicles.length > 0 && (
        <ul className="mt-3 space-y-2">
          {fleet.vehicles.map((v) => (
            <li key={v.id} className="rounded-xl border border-asphalt-700 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{v.name} <span className="num text-xs font-normal text-mist-400">{v.plate}</span></span>
                <span className="text-xs text-mist-400">{Math.round(v.condition)} %</span>
              </div>
              <div className="mt-0.5 text-xs text-mist-400">{v.borrower ? `При ${v.borrower}` : `На паркинга · ${v.city}`} · {Math.round(v.odometerKm).toLocaleString('bg-BG')} км</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {!v.lentTo && !myVehicleId && <ActionButton action={{ type: 'borrowOrgVehicle', orgVehicleId: v.id }} className="btn-primary px-3 py-1 text-xs">Вземи за курсове</ActionButton>}
                {v.lentTo === me && myVehicleId && <ActionButton action={{ type: 'returnOrgVehicle', vehicleId: myVehicleId }} className="btn-ghost px-3 py-1 text-xs" confirm="Да върнем ли камиона на компанията? Остава в града, където е сега.">Върни на компанията</ActionButton>}
                {canManage && !v.lentTo && <ActionButton action={{ type: 'sellOrgVehicle', orgVehicleId: v.id }} className="btn-ghost px-3 py-1 text-xs text-loss" confirm="Да продадем ли камиона? Парите отиват в касата.">Продай</ActionButton>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canManage && fleet.limit > fleet.vehicles.length && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select className="input min-w-0 flex-1 py-1.5 text-sm" value={modelId} onChange={(e) => setModelId(e.target.value)} aria-label="Модел за компанията">
            {MODELS.map((m) => <option key={m.id} value={m.id}>{m.name} · {money(m.priceCents)}</option>)}
          </select>
          <ActionButton action={{ type: 'buyOrgVehicle', modelId }} className="btn-primary px-3 py-1.5 text-sm" disabled={!model || model.priceCents > treasuryCents} confirm={model ? `Да купим ${model.name} от касата за ${money(model.priceCents)}?` : undefined}>Купи</ActionButton>
        </div>
      )}
    </div>
  );
}
