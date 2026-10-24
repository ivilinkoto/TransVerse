import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Camera } from 'lucide-react';
import { ActionButton } from '@/components/ui/ActionButton';
import { LEGEND, legendTier, MUSEUM, SCRAP } from '@/lib/game/heritage';
import { membershipOf } from '@/server/game/membership';
import { sparePartsOf } from '@/server/game/heritage';
import { Showcase } from '@/components/garage/Showcase';
import { Badge, Card, PageHeader } from '@/components/ui';
import { int, money } from '@/lib/format';
import { COSMETIC_PARTS, type CosmeticPart } from '@/lib/game/cosmetics';
import { TRAILER_UPGRADES, UPGRADES, type TrailerUpgradeId, type UpgradeId } from '@/lib/game/catalog';
import { isMarta } from '@/lib/game/marta';
import { gameContext } from '@/server/game/context';
import { fleetView } from '@/server/game/queries';
import { t as tr, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: tr('Витрина') };
}

/** The garage showcase (v1.5): the truck large, with everything fitted on it listed. */
export default async function ShowcasePage({ params }: { params: Promise<{ id: string }> }) {
  await initLocale();
  const { db, user, company, now, features } = await gameContext();
  if (!features.garage_showcase) notFound();
  const { id } = await params;
  const v = (await fleetView(db, company.id)).vehicles.find((x) => x.id === id);
  if (!v) notFound();
  const [spare, membership] = await Promise.all([features.scrapyard ? sparePartsOf(db, user.id) : 0, features.museum ? membershipOf(db, user.id) : null]);
  const museumLevel = (membership?.company.upgrades as { museum?: number } | undefined)?.museum ?? 0;
  const tier = features.legendary_trucks ? legendTier(v.odometerKm) : 0;
  const nextLegend = LEGEND.find((t) => v.odometerKm < t.km);
  const own = v.ownership === 'owned';
  const parts = Object.entries(v.cosmetics).filter(([k, val]) => k in COSMETIC_PARTS && val) as [CosmeticPart, string][];
  return (
    <div className="space-y-6">
      <Link href="/game/garage" className="inline-flex items-center gap-1 text-sm text-mist-300 hover:text-white"><ArrowLeft className="h-4 w-4" />{tr('Към сервиза')}</Link>
      <PageHeader
        title={`${v.model.brand} ${v.model.name}`}
        subtitle={tr('{0} · {1} км · {2} %', v.plate, int(v.odometerKm), Math.round(v.condition))}
        actions={features.photo_mode ? <Link href={`/game/garage/${v.id}/photo`} className="btn-ghost"><Camera className="h-4 w-4" />{tr('Фото режим')}</Link> : undefined}
      />
      {tier > 0 && <div><Badge tone={tier === 3 ? 'gold' : tier === 2 ? 'neutral' : 'orange'}>🏆 {tx(LEGEND[tier - 1]!.title)}</Badge></div>}
      <Card>
        <Showcase hasTrailer={!!v.trailer} truck={{ modelId: v.modelId, trailerModelId: v.trailer?.modelId ?? null, color: v.color, livery: v.livery, cosmetics: v.cosmetics, trailerUpgrades: v.trailer?.upgrades, trailerLogo: v.trailer?.logo, trailerCosmetics: v.trailer?.cosmetics, martenitsa: features.marta && isMarta(now) }} />
      </Card>
      <div className="grid gap-4 md:grid-cols-3">
        <Card title={tr('Подобрения на камиона')}>
          {v.upgrades.length ? <ul className="space-y-1 text-sm">{v.upgrades.map((u) => <li key={u}>✔ {UPGRADES[u as UpgradeId]?.label ?? u} <span className="text-xs text-mist-400">· {tx(UPGRADES[u as UpgradeId]?.description)}</span></li>)}</ul> : <p className="text-sm text-mist-400">{tr('Няма.')}</p>}
        </Card>
        <Card title={tr('Части')}>
          {parts.length ? <ul className="space-y-1 text-sm">{parts.map(([p, val]) => <li key={p}>✔ {tx(COSMETIC_PARTS[p].label)}: {COSMETIC_PARTS[p].styles.find((s) => s.id === val)?.label ?? val}</li>)}</ul> : <p className="text-sm text-mist-400">{tr('Няма — вземи от магазина.')}</p>}
        </Card>
        <Card title={tr('Ремарке')}>
          {v.trailer ? (
            <div className="space-y-1 text-sm">
              <div>{tx(v.trailer.model.name)} <span className="font-mono text-xs text-mist-400">{tx(v.trailer.plate)}</span> {v.trailer.ownership === 'company' && <Badge tone="cyan">{tr('фирмено')}</Badge>}</div>
              {v.trailer.upgrades.length ? <ul>{v.trailer.upgrades.map((u) => <li key={u}>✔ {TRAILER_UPGRADES[u as TrailerUpgradeId]?.label ?? u}</li>)}</ul> : <p className="text-mist-400">{tr('Без подобрения.')}</p>}
            </div>
          ) : <p className="text-sm text-mist-400">{tr('Без ремарке.')}</p>}
        </Card>
      </div>
      {own && (features.scrapyard || features.museum || features.legendary_trucks) && (
        <Card title={tr('Пътят на камиона')}>
          <div className="space-y-3 text-sm text-mist-300">
            {features.legendary_trucks && <p>{nextLegend ? tr('До „{0}“: {1} км (+{2} TC).', nextLegend.title, int(nextLegend.km - v.odometerKm), nextLegend.coins) : tr('Златна легенда — по-далеч няма.')}</p>}
            {features.scrapyard && (
              <div className="flex flex-wrap items-center gap-2">
                <span>{tr('Резервни части:')}{' '}<span className="num font-semibold text-mist-100">{spare}</span></span>
                <ActionButton action={{ type: 'repairWithPart', vehicleId: v.id }} disabled={!spare || v.condition >= 100 || v.status !== 'idle'}>{tr('Ремонт с част (+{0} %)', SCRAP.repairPerPart)}</ActionButton>
                <ActionButton action={{ type: 'scrapVehicle', vehicleId: v.id }} disabled={v.status !== 'idle'} confirm={tr('Камионът отива за скрап: {0} и {1} резервни части. Не може да се върне.', money(Math.round(v.model.priceCents * SCRAP.share)), SCRAP.parts[v.model.kind] ?? 1)}>{tr('За скрап')}</ActionButton>
              </div>
            )}
            {features.museum && membership && (
              <div className="flex flex-wrap items-center gap-2">
                {museumLevel ? (
                  <ActionButton action={{ type: 'donateToMuseum', vehicleId: v.id }} disabled={v.status !== 'idle' || v.odometerKm < MUSEUM.minKm} confirm={tr('Камионът отива в музея на компанията завинаги. Да го дарим ли?')}>{tr('Дари на музея')}</ActionButton>
                ) : null}
                <span className="text-xs text-mist-400">{museumLevel ? tr('Музеят приема камиони с поне {0} км.', int(MUSEUM.minKm)) : tr('Компанията още няма музей на участъка.')} <Link href="/game/company/museum" className="underline">{tr('Музеят')}</Link></span>
              </div>
            )}
          </div>
        </Card>
      )}
      <p className="text-xs text-mist-400">{tr('Рисунката е в страничен изглед, в реални пропорции (оригинални рисунки, измислени марки).')}</p>
    </div>
  );
}
