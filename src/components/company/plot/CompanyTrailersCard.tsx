'use client';

import { Container } from 'lucide-react';
import { useState } from 'react';
import { ActionButton } from '@/components/ui/ActionButton';
import { TrailerIllustration } from '@/components/vehicles/VehicleIllustration';
import { money } from '@/lib/format';
import { TRAILER_UPGRADES, TRAILERS, trailerModel } from '@/lib/game/catalog';
import { COMPANY_TRAILERS } from '@/lib/game/company-fleet';
import { t as tr, tx } from '@/i18n/t';

export interface OrgTrailerList {
  limit: number;
  trailers: { id: string; modelId: string; name: string; plate: string; city: string; condition: number; upgrades: string[]; borrower: string | null; lentTo: string | null }[];
}

/** The company's own trailers (v1.4): members borrow one; ranks with "Развитие" buy, upgrade and sell them. */
export function CompanyTrailersCard({ list, me, myTrailerId, canManage, treasuryCents, companyName }: { list: OrgTrailerList; me: string; myTrailerId: string | null; canManage: boolean; treasuryCents: number; companyName: string }) {
  const [modelId, setModelId] = useState(TRAILERS[0]?.id ?? '');
  const model = TRAILERS.find((m) => m.id === modelId);
  const logo = companyName.toUpperCase().slice(0, 16);
  return (
    <div className="panel p-4 text-sm">
      <h3 className="flex items-center gap-2 font-display text-lg font-bold"><Container className="h-5 w-5 text-cyan-glow" />{tr('Фирмени ремаркета')}{' '}<span className="text-xs font-normal text-mist-400">{tx(list.trailers.length)} / {tx(list.limit)}</span></h3>
      <p className="mt-1 text-mist-300">
        {tr('Ремаркета на компанията с името ѝ отстрани. Член ги взема безплатно; всеки курс с тях дава {0} % от товара като бонус в касата (плаща играта, не шофьорът) и {1} % повече опит за компанията. Игрови данни.', Math.round(COMPANY_TRAILERS.treasuryShare * 100), Math.round((COMPANY_TRAILERS.companyXp - 1) * 100))}
      </p>
      {list.limit === 0 && <p className="mt-2 text-xs text-mist-400">{tr('Нужен е паркинг на участъка: всяко ниво дава {0} места за фирмени ремаркета.', COMPANY_TRAILERS.perParkingLevel)}</p>}
      {list.trailers.length > 0 && (
        <ul className="mt-3 space-y-2">
          {list.trailers.map((t) => {
            const body = trailerModel(t.modelId).body;
            return (
              <li key={t.id} className="rounded-xl border border-asphalt-700 p-3">
                <TrailerIllustration modelId={t.modelId} upgrades={t.upgrades} logo={logo} className="h-12 w-full" />
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="font-semibold">{tx(t.name)} <span className="num text-xs font-normal text-mist-400">{tx(t.plate)}</span></span>
                  <span className="text-xs text-mist-400">{Math.round(t.condition)} %</span>
                </div>
                <div className="mt-0.5 text-xs text-mist-400">{t.borrower ? tr('При {0}', t.borrower) : tr('На паркинга · {0}', t.city)}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {!t.lentTo && !myTrailerId && <ActionButton action={{ type: 'borrowOrgTrailer', orgTrailerId: t.id }} className="btn-primary px-3 py-1 text-xs">{tr('Вземи за курсове')}</ActionButton>}
                  {t.lentTo === me && myTrailerId && <ActionButton action={{ type: 'returnOrgTrailer', trailerId: myTrailerId }} className="btn-ghost px-3 py-1 text-xs" confirm={tr('Да върнем ли ремаркето на компанията? Остава в града, където е сега.')}>{tr('Върни на компанията')}</ActionButton>}
                  {canManage && !t.lentTo && <ActionButton action={{ type: 'sellOrgTrailer', orgTrailerId: t.id }} className="btn-ghost px-3 py-1 text-xs text-loss" confirm={tr('Да продадем ли ремаркето? Парите отиват в касата.')}>{tr('Продай')}</ActionButton>}
                </div>
                {canManage && !t.lentTo && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {Object.values(TRAILER_UPGRADES).filter((u) => u.id !== 'company_logo' && !t.upgrades.includes(u.id) && (!u.bodies || u.bodies.includes(body))).map((u) => (
                      <ActionButton key={u.id} action={{ type: 'upgradeOrgTrailer', orgTrailerId: t.id, upgradeId: u.id }} className="btn-ghost px-2 py-1 text-xs" disabled={u.priceCents > treasuryCents} confirm={tr('{0} ({1}) от касата за {2}?', u.label, u.description, money(u.priceCents))}>+ {tx(u.label)} · {money(u.priceCents)}</ActionButton>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canManage && list.limit > list.trailers.length && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select className="input min-w-0 flex-1 py-1.5 text-sm" value={modelId} onChange={(e) => setModelId(e.target.value)} aria-label={tr('Ремарке за компанията')}>
            {TRAILERS.map((m) => <option key={m.id} value={m.id}>{tx(m.name)} · {money(m.priceCents)}</option>)}
          </select>
          <ActionButton action={{ type: 'buyOrgTrailer', modelId }} className="btn-primary px-3 py-1.5 text-sm" disabled={!model || model.priceCents > treasuryCents} confirm={model ? tr('Да купим {0} от касата за {1}?', model.name, money(model.priceCents)) : undefined}>{tr('Купи')}</ActionButton>
        </div>
      )}
    </div>
  );
}
