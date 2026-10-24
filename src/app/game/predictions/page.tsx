import { notFound } from 'next/navigation';
import { Swords } from 'lucide-react';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { PREDICTIONS } from '@/lib/game/predictions';
import { gameContext } from '@/server/game/context';
import { predictionBoard } from '@/server/game/predictions';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Прогнози') };
}

export default async function PredictionsPage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.predictions) notFound();
  const board = await predictionBoard(db, user.id, now);
  return (
    <div className="space-y-6">
      <PageHeader
        title={t('Прогнози')}
        subtitle={t('Познай коя компания печели битката тази седмица. Безплатно — без залог. Точната прогноза носи {0} TC.', PREDICTIONS.coins)}
        help={t('До {0} прогнози на седмица, до {1} часа преди края на битката. Нищо не се залага — наградата е от играта. Остават ти {2} за седмицата.', PREDICTIONS.perWeek, PREDICTIONS.closeHours, board.left)}
      />
      <Card>
        {board.battles.length === 0 ? <Empty icon={Swords} title={t('Няма битки тази седмица')}>{t('Битките на компаниите се определят в понеделник.')}</Empty> : (
          <ul className="divide-y divide-asphalt-800">
            {board.battles.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <span className="font-semibold">{tx(b.aName)}{b.aTag ? ` [${b.aTag}]` : ''} <span className="text-mist-400">{t('срещу')}</span> {tx(b.bName)}{b.bTag ? ` [${b.bTag}]` : ''}</span>
                {b.pick ? <Badge tone="violet">{t('Твоят избор: {0}', b.pick === b.aId ? b.aName : b.bName)}</Badge> : b.open && board.left > 0 ? (
                  <span className="flex gap-2">
                    <ActionButton action={{ type: 'predictBattle', battleId: b.id, pickOrgId: b.aId }} className="btn-ghost px-3 py-1.5 text-xs">{tx(b.aName)}</ActionButton>
                    <ActionButton action={{ type: 'predictBattle', battleId: b.id, pickOrgId: b.bId }} className="btn-ghost px-3 py-1.5 text-xs">{tx(b.bName)}</ActionButton>
                  </span>
                ) : <Badge>{b.open ? t('без оставащи прогнози') : t('затворено')}</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
