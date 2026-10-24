import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PhotoMode } from '@/components/garage/PhotoMode';
import { Card, PageHeader } from '@/components/ui';
import { isMarta } from '@/lib/game/marta';
import { gameContext } from '@/server/game/context';
import { fleetView } from '@/server/game/queries';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Фото режим') };
}

/** Photo mode (v1.6): the player's truck on a scene, saved as a picture. */
export default async function PhotoPage({ params }: { params: Promise<{ id: string }> }) {
  await initLocale();
  const { db, company, now, features } = await gameContext();
  if (!features.photo_mode) notFound();
  const { id } = await params;
  const v = (await fleetView(db, company.id)).vehicles.find((x) => x.id === id);
  if (!v) notFound();
  return (
    <div className="space-y-6">
      <Link href={`/game/garage/${v.id}`} className="inline-flex items-center gap-1 text-sm text-mist-300 hover:text-white"><ArrowLeft className="h-4 w-4" />{t('Към витрината')}</Link>
      <PageHeader title={t('Фото режим')} subtitle={`${v.model.brand} ${v.model.name} · ${v.plate}`} />
      <Card>
        <PhotoMode plate={v.plate} hasTrailer={!!v.trailer} truck={{ modelId: v.modelId, trailerModelId: v.trailer?.modelId ?? null, color: v.color, livery: v.livery, cosmetics: v.cosmetics, trailerUpgrades: v.trailer?.upgrades, trailerLogo: v.trailer?.logo, trailerCosmetics: v.trailer?.cosmetics, martenitsa: features.marta && isMarta(now) }} />
      </Card>
    </div>
  );
}
