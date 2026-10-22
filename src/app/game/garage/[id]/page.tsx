import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Showcase } from '@/components/garage/Showcase';
import { Badge, Card, PageHeader } from '@/components/ui';
import { int } from '@/lib/format';
import { COSMETIC_PARTS, type CosmeticPart } from '@/lib/game/cosmetics';
import { TRAILER_UPGRADES, UPGRADES, type TrailerUpgradeId, type UpgradeId } from '@/lib/game/catalog';
import { isMarta } from '@/lib/game/marta';
import { gameContext } from '@/server/game/context';
import { fleetView } from '@/server/game/queries';

export const metadata = { title: 'Витрина' };

/** The garage showcase (v1.5): the truck large, with everything fitted on it listed. */
export default async function ShowcasePage({ params }: { params: Promise<{ id: string }> }) {
  const { db, company, now, features } = await gameContext();
  if (!features.garage_showcase) notFound();
  const { id } = await params;
  const v = (await fleetView(db, company.id)).vehicles.find((x) => x.id === id);
  if (!v) notFound();
  const parts = Object.entries(v.cosmetics).filter(([k, val]) => k in COSMETIC_PARTS && val) as [CosmeticPart, string][];
  return (
    <div className="space-y-6">
      <Link href="/game/garage" className="inline-flex items-center gap-1 text-sm text-mist-300 hover:text-white"><ArrowLeft className="h-4 w-4" />Към сервиза</Link>
      <PageHeader title={`${v.model.brand} ${v.model.name}`} subtitle={`${v.plate} · ${int(v.odometerKm)} км · ${Math.round(v.condition)} %`} />
      <Card>
        <Showcase hasTrailer={!!v.trailer} truck={{ modelId: v.modelId, trailerModelId: v.trailer?.modelId ?? null, color: v.color, livery: v.livery, cosmetics: v.cosmetics, trailerUpgrades: v.trailer?.upgrades, trailerLogo: v.trailer?.logo, martenitsa: features.marta && isMarta(now) }} />
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
      <p className="text-xs text-mist-400">Рисунката е в страничен изглед, в реални пропорции (оригинални рисунки, измислени марки).</p>
    </div>
  );
}
