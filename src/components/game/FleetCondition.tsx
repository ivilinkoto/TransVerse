import { Wrench } from 'lucide-react';
import Link from 'next/link';
import { Badge, Card, Meter } from '@/components/ui';
import { serviceState } from '@/lib/game/economy';

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
    <Card
      className="mb-4"
      title={<span className="inline-flex items-center gap-2"><Wrench className="h-4 w-4 text-mist-400" />Състояние на камионите</span>}
      actions={attention ? <Link href="/game/garage" className="text-sm text-amber-sig hover:underline">{attention} за сервиз → Гараж</Link> : <span className="text-xs text-mist-400">всички са изправни</span>}
    >
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => {
          const state = r.rented ? null : STATE[serviceState(r.condition)];
          return (
            <li key={r.id} className="rounded-xl border border-asphalt-700 px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-semibold">{r.plate} <span className="font-normal text-mist-400">· {r.model}</span></span>
                <span className="num shrink-0 font-semibold">{Math.round(r.condition)}%</span>
              </div>
              <Meter value={r.condition} className="mt-1.5" />
              <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-mist-400">
                <span>{r.onTrip ? 'на курс' : `свободен · ${r.city}`}</span>
                {state ? <Badge tone={state.tone}>{state.label}</Badge> : <Badge tone="gold">сервиз от наемодателя</Badge>}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
