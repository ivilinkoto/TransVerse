import { notFound } from 'next/navigation';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { CabinView } from '@/components/game/CabinView';
import { LaneGame } from '@/components/game/LaneGame';
import { eraAt, nextEra } from '@/lib/game/eras';
import { LANE } from '@/lib/game/lane';
import { cabinTrips } from '@/server/game/cabin';
import { gameContext } from '@/server/game/context';
import { Truck } from 'lucide-react';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Кабина') };
}

/** v2.0: the cab of every truck on a trip, this month's era and the lane mini-game. */
export default async function CabinPage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.cabin) notFound();
  const trips = await cabinTrips(db, user.id);
  const era = eraAt(now);
  const next = nextEra(now);
  return (
    <div className="space-y-6">
      <PageHeader title={t('Кабина')} subtitle={t('Седни зад волана на камионите си по време на курс: пътят, таблото и небето по местното време.')} />
      {features.eras && (
        <Card title={<span>{era.icon} {tx(era.label)}</span>} actions={<Badge tone="gold">{t('Ерата на месеца')}</Badge>}>
          <p className="text-sm text-mist-300">{tx(era.body)}</p>
          <p className="mt-1 text-xs text-mist-400">{t('Следващия месец: {0} {1}', next.icon, tx(next.label))}</p>
        </Card>
      )}
      {trips.length ? (
        trips.map((trip) => (
          <div key={trip.id} className="space-y-3">
            <CabinView trip={trip} serverNow={now.getTime()} />
            <Card title={t('Лентата')}>
              <p className="mb-3 text-xs text-mist-400">{t('Веднъж на курс: дръж камиона в лентата по завоите. Звезди по дела време в лентата ({0} / {1} / {2} %) · опит {3}.', LANE.stars[0] * 100, LANE.stars[1] * 100, LANE.stars[2] * 100, LANE.xp.slice(1).join(' / '))}</p>
              <LaneGame deliveryId={trip.id} played={trip.lanePlayed} />
            </Card>
          </div>
        ))
      ) : (
        <Empty icon={Truck} title={t('Няма камион на курс')}>{t('Вземи товар и се върни в кабината.')}</Empty>
      )}
    </div>
  );
}
