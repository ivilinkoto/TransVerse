import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { CB, REPORTS } from '@/lib/game/live-road';
import { gameContext } from '@/server/game/context';
import { activeReports, cbFeed, trucksOnRoad } from '@/server/game/live-road';
import { hitchhikersOf } from '@/server/game/road-life';
import { RoadClient } from './RoadClient';
import { t as tr } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: tr('Пътят') };
}

/** v1.8: CB radio (channel 19) and road reports from the drivers. Made by the players. */
export default async function RoadPage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.cb_radio && !features.road_reports && !features.hitchhikers) notFound();
  const trucks = await trucksOnRoad(db, user.id, now);
  const [feed, reports, riders] = await Promise.all([
    features.cb_radio ? cbFeed(db, user.id, now) : null,
    features.road_reports ? activeReports(db, now, user.id, trucks.map((t) => t.position)) : [],
    features.hitchhikers ? hitchhikersOf(db, user.id, now) : [],
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        title={tr('Пътят')}
        subtitle={tr('CB радио канал {0} и сигнали от шофьорите. Чуваш тези до {1} км от камионите си на път. Съобщенията и сигналите са от играчите.', CB.channel, CB.radiusKm)}
        help={tr('Сигнал се дава от камион на път и стои {0} мин; всяко потвърждение го удължава. Потвърждават и отхвърлят шофьори с камион до {1} км от мястото. При {2} потвърждения авторът получава +{3} репутация, а при {4} отхвърляния (повече от потвържденията) губи толкова.', REPORTS.ttlMin, REPORTS.voteRadiusKm, REPORTS.confirmsToReward, REPORTS.reputation, REPORTS.deniesToRemove)}
      />
      <RoadClient
        trucks={trucks.map((t) => ({ vehicleId: t.vehicleId, plate: t.plate }))}
        feed={feed}
        reports={reports}
        cbLive={features.cb_radio}
        reportsLive={features.road_reports}
        riders={riders}
      />
    </div>
  );
}
