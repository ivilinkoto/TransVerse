import { notFound } from 'next/navigation';
import { Swords } from 'lucide-react';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { PREDICTIONS } from '@/lib/game/predictions';
import { gameContext } from '@/server/game/context';
import { predictionBoard } from '@/server/game/predictions';

export const metadata = { title: 'Прогнози' };

export default async function PredictionsPage() {
  const { db, user, now, features } = await gameContext();
  if (!features.predictions) notFound();
  const board = await predictionBoard(db, user.id, now);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Прогнози"
        subtitle={`Познай коя компания печели битката тази седмица. Безплатно — без залог. Точната прогноза носи ${PREDICTIONS.coins} TC.`}
        help={`До ${PREDICTIONS.perWeek} прогнози на седмица, до ${PREDICTIONS.closeHours} часа преди края на битката. Нищо не се залага — наградата е от играта. Остават ти ${board.left} за седмицата.`}
      />
      <Card>
        {board.battles.length === 0 ? <Empty icon={Swords} title="Няма битки тази седмица">Битките на компаниите се определят в понеделник.</Empty> : (
          <ul className="divide-y divide-asphalt-800">
            {board.battles.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <span className="font-semibold">{b.aName}{b.aTag ? ` [${b.aTag}]` : ''} <span className="text-mist-400">срещу</span> {b.bName}{b.bTag ? ` [${b.bTag}]` : ''}</span>
                {b.pick ? <Badge tone="violet">Твоят избор: {b.pick === b.aId ? b.aName : b.bName}</Badge> : b.open && board.left > 0 ? (
                  <span className="flex gap-2">
                    <ActionButton action={{ type: 'predictBattle', battleId: b.id, pickOrgId: b.aId }} className="btn-ghost px-3 py-1.5 text-xs">{b.aName}</ActionButton>
                    <ActionButton action={{ type: 'predictBattle', battleId: b.id, pickOrgId: b.bId }} className="btn-ghost px-3 py-1.5 text-xs">{b.bName}</ActionButton>
                  </span>
                ) : <Badge>{b.open ? 'без оставащи прогнози' : 'затворено'}</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
