import { ChevronDown, Wrench } from 'lucide-react';
import Link from 'next/link';
import { Badge, Meter } from '@/components/ui';
import { serviceState } from '@/lib/game/economy';
import { t, tx } from '@/i18n/t';

export interface ConditionRow {
  id: string;
  plate: string;
  model: string;
  city: string;
  condition: number;
  onTrip: boolean;
  rented: boolean;
}

const STATE = {
  ok: { label: 'изправен', tone: 'green' },
  soon: { label: 'скоро на сервиз', tone: 'orange' },
  required: { label: 'нужен ремонт', tone: 'red' },
} as const;

/** Condition of every truck before choosing a job: who needs a service and who cannot take jobs until repaired. */
export function FleetCondition({ rows }: { rows: ConditionRow[] }) {
  if (!rows.length) return null;
  const attention = rows.filter((r) => !r.rented && serviceState(r.condition) !== 'ok').length;
  return (
    <details open={attention > 0} className="panel group mb-4 p-0">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
        <Wrench className="h-4 w-4 text-mist-400" />
        <span className="font-semibold">{t('Състояние')}<span className="max-sm:hidden">{' '}{t('на камионите')}</span></span>
        {attention ? <span className="text-amber-sig">{t('· {0} за сервиз', attention)}</span> : <span className="text-mist-400">{t('· всички са изправни')}</span>}
        <ChevronDown className="ml-auto h-4 w-4 text-mist-400 transition group-open:rotate-180" />
      </summary>
      <div className="px-4 pb-4">
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => {
            const state = r.rented ? null : STATE[serviceState(r.condition)];
            return (
              <li key={r.id} className="rounded-xl border border-asphalt-700 px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold">{tx(r.plate)} <span className="font-normal text-mist-400">· {tx(r.model)}</span></span>
                  <span className="num shrink-0 font-semibold">{Math.round(r.condition)}%</span>
                </div>
                <Meter value={r.condition} className="mt-1.5" />
                <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-mist-400">
                  <span>{r.onTrip ? t('на курс') : t('свободен · {0}', r.city)}</span>
                  {state ? <Badge tone={state.tone}>{tx(state.label)}</Badge> : <Badge tone="gold">{t('сервиз от наемодателя')}</Badge>}
                </div>
              </li>
            );
          })}
        </ul>
        {attention > 0 && <Link href="/game/garage" className="mt-3 inline-block text-sm text-amber-sig hover:underline">{t('Към сервиза →')}</Link>}
      </div>
    </details>
  );
}
