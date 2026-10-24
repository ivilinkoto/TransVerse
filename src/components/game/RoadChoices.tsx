import { Card } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { pendingChoices } from '@/server/game/road-choices';
import type { DbOrTx } from '@/server/db/client';

/** Decisions on the way waiting for the player (Решения в движение, v1.10). */
export async function RoadChoices({ db, companyId, now }: { db: DbOrTx; companyId: string; now: Date }) {
  const list = await pendingChoices(db, companyId, now);
  if (!list.length) return null;
  return (
    <div className="space-y-3">
      {list.map((c) => (
        <Card key={c.deliveryId} title={<span>{c.scenario.emoji} Решение на пътя: {c.scenario.title}</span>} actions={<span className="text-xs text-mist-400">{c.plate} → {c.dest} · {Math.max(0, Math.round((c.deadline - now.getTime()) / 60_000))} мин за избор</span>}>
          <p className="mb-3 text-sm text-mist-300">{c.scenario.text}</p>
          <div className="flex flex-wrap gap-2">
            <ActionButton action={{ type: 'roadChoice', deliveryId: c.deliveryId, option: 'a' }} className="btn-primary px-3 py-1.5 text-sm">{c.scenario.a.label}</ActionButton>
            <ActionButton action={{ type: 'roadChoice', deliveryId: c.deliveryId, option: 'b' }} className="btn-ghost px-3 py-1.5 text-sm">{c.scenario.b.label}</ActionButton>
          </div>
          <p className="mt-2 text-[11px] text-mist-500">Без избор шофьорът поема по втория, по-спокойния вариант.</p>
        </Card>
      ))}
    </div>
  );
}
