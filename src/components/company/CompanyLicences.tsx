import { BadgeCheck, CircleDashed, Clock } from 'lucide-react';
import { Card } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { date, money } from '@/lib/format';
import { companyLicencePrice, LICENCE_IDS, LICENCES, type LicenceId } from '@/lib/game/licences';

/** The company's licences: bought ones (usable by every member) and the missing ones, with a buy button for those allowed. */
export function CompanyLicences({ held, canBuy = false, treasuryCents }: { held: { licence: string; acquiredAt: Date }[]; canBuy?: boolean; treasuryCents?: number }) {
  const owned = new Map(held.map((h) => [h.licence, h]));
  const ids = [...LICENCE_IDS].sort((a, b) => Number(owned.has(b)) - Number(owned.has(a)) || Number(LICENCES[b].available) - Number(LICENCES[a].available));
  return (
    <Card title={<span className="inline-flex items-center gap-2"><BadgeCheck className="h-4 w-4 text-mist-400" />Лицензи на компанията</span>} actions={<span className="text-xs text-mist-400">{owned.size} от {LICENCE_IDS.filter((id) => LICENCES[id].available).length} налични</span>}>
      <p className="mb-3 text-sm text-mist-400">Купуват се от касата на двойна цена и важат за всички членове на компанията.</p>
      <ul className="divide-y divide-asphalt-800 text-sm">
        {ids.map((id: LicenceId) => {
          const def = LICENCES[id];
          const have = owned.get(id);
          const blockedBy = def.requires && !owned.has(def.requires) ? LICENCES[def.requires].short : null;
          return (
            <li key={id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="flex items-center gap-2">
                {have ? <BadgeCheck className="h-4 w-4 text-profit" /> : def.available ? <CircleDashed className="h-4 w-4 text-mist-400" /> : <Clock className="h-4 w-4 text-mist-500" />}
                <span className={have ? 'font-semibold' : def.available ? '' : 'text-mist-500'}>{def.label}</span>
              </span>
              {have ? (
                <span className="text-xs text-profit">има · от {date(have.acquiredAt)}</span>
              ) : !def.available ? (
                <span className="text-xs text-mist-500">скоро</span>
              ) : canBuy ? (
                <ActionButton
                  action={{ type: 'buyCompanyLicence', licenceId: id }}
                  className="btn-ghost px-3 py-1 text-xs"
                  disabled={!!blockedBy || (treasuryCents ?? 0) < companyLicencePrice(id)}
                  confirm={`Да купим ли „${def.label}“ за ${money(companyLicencePrice(id))} от касата?`}
                >
                  {blockedBy ? `първо ${blockedBy}` : `Купи · ${money(companyLicencePrice(id))}`}
                </ActionButton>
              ) : (
                <span className="text-xs text-amber-sig">липсва · {money(companyLicencePrice(id))}</span>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
