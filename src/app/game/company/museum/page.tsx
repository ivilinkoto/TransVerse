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
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Музей') };
}

/** The company museum (v1.6): the trucks the members donated. */
export default async function MuseumPage() {
  await initLocale();
  const { db, user, features } = await gameContext();
  if (!features.museum) notFound();
  const m = await membershipOf(db, user.id);
  if (!m) redirect('/game/company');
  const level = (m.company.upgrades as { museum?: number }).museum ?? 0;
  const exhibits = await museumOf(db, m.company.id);
  return (
    <div className="space-y-6">
      <PageHeader
        title={t('Музеят на „{0}“', m.company.name)}
        subtitle={level ? t('Ниво {0} · {1} / {2} експоната', level, exhibits.length, MUSEUM.capacity[level]) : t('Компанията още няма музей — постройте го на участъка.')}
        help={t('Член дарява свой камион с поне {0} км от витрината му в сервиза. Камионът остава в музея завинаги, дарителят получава {1} TC ({2} TC за легенда).', int(MUSEUM.minKm), MUSEUM.coins, MUSEUM.legendCoins)}
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
                  <span className="font-semibold">{tx(model.brand)} {tx(model.name)}</span>
                  <span className="font-mono text-xs text-mist-400">{tx(e.plate)}</span>
                  {tier ? <Badge tone="gold">🏆 {tx(LEGEND[tier - 1]!.title)}</Badge> : null}
                </div>
                <p className="mt-1 text-sm text-mist-300">{t('{0} км · дарен от {1} · {2}', int(e.odometerKm), e.donor ?? '—', dateTime(e.donatedAt))}</p>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card><Empty icon={Landmark} title={t('Залата е празна')}>{t('Дарете първия камион от витрината му в сервиза.')}</Empty></Card>
      )}
    </div>
  );
}
