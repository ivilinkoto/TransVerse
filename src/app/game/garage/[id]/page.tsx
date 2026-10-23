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

export const metadata = { title: 'Витрина' };

/** The garage showcase (v1.5): the truck large, with everything fitted on it listed. */
export default async function ShowcasePage({ params }: { params: Promise<{ id: string }> }) {
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
      <Link href="/game/garage" className="inline-flex items-center gap-1 text-sm text-mist-300 hover:text-white"><ArrowLeft className="h-4 w-4" />Към сервиза</Link>
      <PageHeader
        title={`${v.model.brand} ${v.model.name}`}
        subtitle={`${v.plate} · ${int(v.odometerKm)} км · ${Math.round(v.condition)} %`}
        actions={features.photo_mode ? <Link href={`/game/garage/${v.id}/photo`} className="btn-ghost"><Camera className="h-4 w-4" />Фото режим</Link> : undefined}
      />
      {tier > 0 && <div><Badge tone={tier === 3 ? 'gold' : tier === 2 ? 'neutral' : 'orange'}>🏆 {LEGEND[tier - 1]!.title}</Badge></div>}
      <Card>
        <Showcase hasTrailer={!!v.trailer} truck={{ modelId: v.modelId, trailerModelId: v.trailer?.modelId ?? null, color: v.color, livery: v.livery, cosmetics: v.cosmetics, trailerUpgrades: v.trailer?.upgrades, trailerLogo: v.trailer?.logo, trailerCosmetics: v.trailer?.cosmetics, martenitsa: features.marta && isMarta(now) }} />
      </Card>
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Подобрения на камиона">
          {v.upgrades.length ? <ul className="space-y-1 text-sm">{v.upgrades.map((u) => <li key={u}>✔ {UPGRADES[u as UpgradeId]?.label ?? u} <span className="text-xs text-mist-400">· {UPGRADES[u as UpgradeId]?.description}</span></li>)}</ul> : <p className="text-sm text-mist-400">Няма.</p>}
        </Card>
        <Card title="Части">
          {parts.length ? <ul className="space-y-1 text-sm">{parts.map(([p, val]) => <li key={p}>✔ {COSMETIC_PARTS[p].label}: {COSMETIC_PARTS[p].styles.find((s) => s.id === val)?.label ?? val}</li>)}</ul> : <p className="text-sm text-mist-400">Няма — вземи от магазина.</p>}
        </Card>
        <Card title="Ремарке">
          {v.trailer ? (
            <div className="space-y-1 text-sm">
              <div>{v.trailer.model.name} <span className="font-mono text-xs text-mist-400">{v.trailer.plate}</span> {v.trailer.ownership === 'company' && <Badge tone="cyan">фирмено</Badge>}</div>
              {v.trailer.upgrades.length ? <ul>{v.trailer.upgrades.map((u) => <li key={u}>✔ {TRAILER_UPGRADES[u as TrailerUpgradeId]?.label ?? u}</li>)}</ul> : <p className="text-mist-400">Без подобрения.</p>}
            </div>
          ) : <p className="text-sm text-mist-400">Без ремарке.</p>}
        </Card>
      </div>
      {own && (features.scrapyard || features.museum || features.legendary_trucks) && (
        <Card title="Пътят на камиона">
          <div className="space-y-3 text-sm text-mist-300">
            {features.legendary_trucks && <p>{nextLegend ? `До „${nextLegend.title}“: ${int(nextLegend.km - v.odometerKm)} км (+${nextLegend.coins} TC).` : 'Златна легенда — по-далеч няма.'}</p>}
            {features.scrapyard && (
              <div className="flex flex-wrap items-center gap-2">
                <span>Резервни части: <span className="num font-semibold text-mist-100">{spare}</span></span>
                <ActionButton action={{ type: 'repairWithPart', vehicleId: v.id }} disabled={!spare || v.condition >= 100 || v.status !== 'idle'}>Ремонт с част (+{SCRAP.repairPerPart} %)</ActionButton>
                <ActionButton action={{ type: 'scrapVehicle', vehicleId: v.id }} disabled={v.status !== 'idle'} confirm={`Камионът отива за скрап: ${money(Math.round(v.model.priceCents * SCRAP.share))} и ${SCRAP.parts[v.model.kind] ?? 1} резервни части. Не може да се върне.`}>За скрап</ActionButton>
              </div>
            )}
            {features.museum && membership && (
              <div className="flex flex-wrap items-center gap-2">
                {museumLevel ? (
                  <ActionButton action={{ type: 'donateToMuseum', vehicleId: v.id }} disabled={v.status !== 'idle' || v.odometerKm < MUSEUM.minKm} confirm="Камионът отива в музея на компанията завинаги. Да го дарим ли?">Дари на музея</ActionButton>
                ) : null}
                <span className="text-xs text-mist-400">{museumLevel ? `Музеят приема камиони с поне ${int(MUSEUM.minKm)} км.` : 'Компанията още няма музей на участъка.'} <Link href="/game/company/museum" className="underline">Музеят</Link></span>
              </div>
            )}
          </div>
        </Card>
      )}
      <p className="text-xs text-mist-400">Рисунката е в страничен изглед, в реални пропорции (оригинални рисунки, измислени марки).</p>
    </div>
  );
}
