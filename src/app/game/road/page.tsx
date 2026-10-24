import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { CB, REPORTS } from '@/lib/game/live-road';
import { gameContext } from '@/server/game/context';
import { activeReports, cbFeed, trucksOnRoad } from '@/server/game/live-road';
import { RoadClient } from './RoadClient';

export const metadata = { title: 'Пътят' };

/** v1.8: CB radio (channel 19) and road reports from the drivers. Made by the players. */
export default async function RoadPage() {
  const { db, user, now, features } = await gameContext();
  if (!features.cb_radio && !features.road_reports) notFound();
  const trucks = await trucksOnRoad(db, user.id, now);
  const [feed, reports] = await Promise.all([
    features.cb_radio ? cbFeed(db, user.id, now) : null,
    features.road_reports ? activeReports(db, now, user.id, trucks.map((t) => t.position)) : [],
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Пътят"
        subtitle={`CB радио канал ${CB.channel} и сигнали от шофьорите. Чуваш тези до ${CB.radiusKm} км от камионите си на път. Съобщенията и сигналите са от играчите.`}
        help={`Сигнал се дава от камион на път и стои ${REPORTS.ttlMin} мин; всяко потвърждение го удължава. Потвърждават и отхвърлят шофьори с камион до ${REPORTS.voteRadiusKm} км от мястото. При ${REPORTS.confirmsToReward} потвърждения авторът получава +${REPORTS.reputation} репутация, а при ${REPORTS.deniesToRemove} отхвърляния (повече от потвържденията) губи толкова.`}
      />
      <RoadClient
        trucks={trucks.map((t) => ({ vehicleId: t.vehicleId, plate: t.plate }))}
        feed={feed}
        reports={reports}
        cbLive={features.cb_radio}
        reportsLive={features.road_reports}
      />
    </div>
  );
}
