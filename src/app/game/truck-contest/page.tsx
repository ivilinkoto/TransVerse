import { notFound } from 'next/navigation';
import { Card, PageHeader } from '@/components/ui';
import { VehicleIllustration } from '@/components/vehicles/VehicleIllustration';
import type { Cosmetics, TrailerCosmetics } from '@/lib/game/cosmetics';
import { TRUCK_CONTEST, type TruckLook } from '@/lib/game/truck-contest';
import { gameContext } from '@/server/game/context';
import { fleetView } from '@/server/game/queries';
import { truckContestView } from '@/server/game/truck-contest';
import { EnterTruck, VoteButton } from './TruckContestClient';

export const metadata = { title: 'Камион на месеца' };

function Truck({ look }: { look: TruckLook }) {
  return (
    <VehicleIllustration
      modelId={look.modelId}
      trailerModelId={look.trailerModelId}
      color={look.color}
      livery={look.livery}
      cosmetics={look.cosmetics as Cosmetics | null}
      trailerUpgrades={look.trailerUpgrades}
      trailerLogo={look.trailerLogo}
      trailerCosmetics={look.trailerCosmetics as TrailerCosmetics | null}
      className="max-h-28 w-full"
    />
  );
}

/** v1.8: the players' trucks, voted on by the players. */
export default async function TruckContestPage() {
  const { db, user, company, features } = await gameContext();
  if (!features.truck_contest) notFound();
  const [view, fleet] = await Promise.all([truckContestView(db, user.id), fleetView(db, company.id)]);
  const own = fleet.vehicles.filter((v) => v.ownership !== 'rented').map((v) => ({ id: v.id, label: `${v.plate} · ${v.model.name}${v.trailer ? ` + ${v.trailer.model.name}` : ''}` }));
  return (
    <div className="space-y-6">
      <PageHeader
        title="Камион на месеца"
        subtitle={`Покажи камиона си — боя, ливрея, части. Всеки има ${TRUCK_CONTEST.votes} гласа на месец. Първите трима (с поне ${TRUCK_CONTEST.minVotes} гласа) печелят ${TRUCK_CONTEST.prizes.join(' / ')} TC, а победителят — значка и място на началната страница.`}
      />
      {view.last?.winners.length ? (
        <Card title={`Миналия месец (${view.last.month})`}>
          <div className="grid gap-3 sm:grid-cols-3">
            {view.last.winners.map((w, i) => (
              <div key={w.title} className="rounded-xl bg-asphalt-850 p-3 text-sm">
                <div className="flex h-28 items-end"><Truck look={w.look} /></div>
                <div className="mt-2 font-semibold">{i + 1}. {w.username}</div>
                <div className="text-xs text-mist-400">{w.title} · {w.votes} гласа</div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
      {!view.entered && own.length > 0 && <Card title="Включи свой камион"><EnterTruck vehicles={own} /></Card>}
      <Card title={`Този месец · ${view.entries.length} камиона · остават ти ${view.votesLeft} гласа`}>
        {view.entries.length === 0 ? (
          <p className="text-sm text-mist-400">Още няма камиони — бъди първият!</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {view.entries.map((e) => (
              <div key={e.id} className={`rounded-xl p-3 text-sm ${e.mine ? 'bg-amber-sig/10' : 'bg-asphalt-850'}`}>
                <div className="flex h-28 items-end"><Truck look={e.look} /></div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="min-w-0"><div className="truncate font-semibold">{e.username}</div><div className="truncate text-xs text-mist-400">{e.title}</div></div>
                  <div className="text-right"><div className="num font-display font-bold">{e.votes}</div><div className="text-[10px] text-mist-400">гласа</div></div>
                </div>
                {!e.mine && <VoteButton entryId={e.id} voted={e.voted} disabled={!view.votesLeft} />}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
