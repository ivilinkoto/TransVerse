import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui';
import { TrainArt } from '@/components/vehicles/trains';
import { HireBoard, place, RunStatus, TrainContracts, TrainOrders } from '@/components/game/TrainOrders';
import { LOCOS, RAIL_TERMINALS, TRAINS, WAGON_TYPES, type WagonType } from '@/lib/game/trains';
import { gameContext } from '@/server/game/context';
import { contractsView, hireBoard, trainsView } from '@/server/game/trains';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Курсове за влакове') };
}

/** 1.3.3 „Жп линия“ (Курсове → Влакове): the block-train orders for each of my idle trains, and the ones on the way. */
export default async function TrainJobsPage({ searchParams }: { searchParams: Promise<{ at?: string; wagon?: string }> }) {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.trains) notFound();
  const v = await trainsView(db, user.id, now);
  const q = await searchParams;
  const wagon = WAGON_TYPES.includes(q.wagon as WagonType) ? (q.wagon as WagonType) : null;
  const at = Number(q.at) || v.trains[0]?.at || RAIL_TERMINALS[0]!.id;
  let hire = await hireBoard(db, user.id, at, now, wagon);
  // 1.3.3: without a chosen station (and no own train), open the one with the best order.
  if (!q.at && !v.trains.length && hire.stations[0] && hire.stations[0].id !== at) hire = await hireBoard(db, user.id, hire.stations[0].id, now, wagon);
  const idle = v.trains.filter((tr) => !tr.run);
  const going = v.trains.filter((tr) => tr.run);
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('Курсове за влакове')}
        subtitle={t('Поръчки за блок-влакове на гарите, където стоят твоите влакове.')}
        help={t('Влакът кара само между товарни гари. На всяка гара има поръчки за блок-влакове ({0}–{1} т), нови на всеки {2} часа. Таксата за линията и енергията се плащат при тръгване, а поръчката — при пристигане. Линиите и разстоянията са истински; цените и поръчките са игрови данни.', TRAINS.tons.min, TRAINS.tons.max, TRAINS.windowHours)}
      />
      <TrainContracts v={await contractsView(db, user.id, now)} />
      {v.trains.length === 0 && (
        <section className="panel space-y-2 p-4" data-testid="train-jobs-empty">
          <p className="text-sm text-mist-200">🚆 {t('Нямаш собствен влак — наеми влак за поръчката по-долу. Собствен влак се купува от VIP{0} в Автопарк → Влакове.', TRAINS.vipLevel)}</p>
          <Link href="/game/trains" className="game-action inline-flex flex-row px-4 py-1.5 text-xs">{t('Към влаковете →')}</Link>
        </section>
      )}
      <ul className="space-y-3" data-testid="train-jobs">
        {idle.map((tr) => (
          <li key={tr.id} className="bus-card space-y-3 rounded-3xl p-4" data-testid="train">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-display text-lg font-bold text-white">{LOCOS[tr.loco].name}</p>
                <p className="text-sm text-mist-200">📍 {t('На гара {0}', place(tr.at))}</p>
              </div>
              <TrainArt loco={tr.loco} wagons={WAGON_TYPES.flatMap((k) => Array.from({ length: tr.wagons[k] ?? 0 }, () => k))} show={3} className="h-10 w-64 max-w-full" />
            </div>
            <TrainOrders tr={tr} now={now} />
          </li>
        ))}
      </ul>
      <HireBoard v={hire} now={now} />
      {going.length > 0 && (
        <section className="panel space-y-2 p-4" data-testid="train-jobs-going">
          <h2 className="font-display text-lg font-bold text-white">{t('На път')}</h2>
          <ul className="space-y-1.5 text-sm">
            {going.map((tr) => (
              <li key={tr.id} className="stat-tile space-y-1 rounded-xl px-3 py-2">
                <p className="font-semibold text-white">{LOCOS[tr.loco].name}</p>
                <RunStatus run={tr.run!} now={now} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
