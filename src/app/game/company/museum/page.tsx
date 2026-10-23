import { Landmark } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { VehicleIllustration } from '@/components/vehicles/VehicleIllustration';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { dateTime, int } from '@/lib/format';
import { powerUnitModel } from '@/lib/game/catalog';
import { LEGEND, legendTier, MUSEUM } from '@/lib/game/heritage';
import { gameContext } from '@/server/game/context';
import { museumOf } from '@/server/game/heritage';
import { membershipOf } from '@/server/game/membership';

export const metadata = { title: 'Музей' };

/** The company museum (v1.6): the trucks the members donated. */
export default async function MuseumPage() {
  const { db, user, features } = await gameContext();
  if (!features.museum) notFound();
  const m = await membershipOf(db, user.id);
  if (!m) redirect('/game/company');
  const level = (m.company.upgrades as { museum?: number }).museum ?? 0;
  const exhibits = await museumOf(db, m.company.id);
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Музеят на „${m.company.name}“`}
        subtitle={level ? `Ниво ${level} · ${exhibits.length} / ${MUSEUM.capacity[level]} експоната` : 'Компанията още няма музей — постройте го на участъка.'}
        help={`Член дарява свой камион с поне ${int(MUSEUM.minKm)} км от витрината му в сервиза. Камионът остава в музея завинаги, дарителят получава ${MUSEUM.coins} TC (${MUSEUM.legendCoins} TC за легенда).`}
      />
      {exhibits.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {exhibits.map((e) => {
            const tier = legendTier(e.odometerKm);
            const model = powerUnitModel(e.modelId);
            return (
              <Card key={e.id}>
                <VehicleIllustration modelId={e.modelId} trailerModelId={null} color={e.color} livery={e.livery} className="h-auto w-full" />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{model.brand} {model.name}</span>
                  <span className="font-mono text-xs text-mist-400">{e.plate}</span>
                  {tier ? <Badge tone="gold">🏆 {LEGEND[tier - 1]!.title}</Badge> : null}
                </div>
                <p className="mt-1 text-sm text-mist-300">{int(e.odometerKm)} км · дарен от {e.donor ?? '—'} · {dateTime(e.donatedAt)}</p>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card><Empty icon={Landmark} title="Залата е празна">Дарете първия камион от витрината му в сервиза.</Empty></Card>
      )}
    </div>
  );
}
