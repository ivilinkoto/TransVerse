import { PageHeader } from '@/components/ui';
import { TutorialVisit } from '@/components/game/TutorialVisit';
import { gameContext } from '@/server/game/context';
import { mapData } from '@/server/game/map-data';
import { tutorialPending } from '@/server/game/tutorial-flags';
import { MapClient } from './MapClient';
import { isVip } from '@/lib/game/vip';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Карта') };
}

export default async function MapPage({ searchParams }: { searchParams: Promise<{ contract?: string }> }) {
  await initLocale();
  const { db, user, company, hq, now, features } = await gameContext();
  const data = await mapData(db, { userId: user.id, companyId: company.id, now, features }, (await searchParams).contract);
  const preview = data.preview;
  const visitPending = await tutorialPending(db, user.id, 'track_map');
  return (
    <div>
      <TutorialVisit step="track_map" pending={visitPending} />
      <PageHeader
        title={t('Карта')}
        subtitle={preview ? t('Преглед на маршрут — {0}{1}', preview.title, preview.approximate ? t(' (приблизителна линия, пътният маршрут не е наличен)') : t(' (реален пътен маршрут за камион)')) : t('Твоите камиони и тези на всички играчи — на живо, по реални пътища.')}
      />
      <MapClient layers={user.uiPrefs.mapLayers} ownVip={isVip(user.vipUntil, now)} styleUrl={process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/dark'} center={[hq.lat, hq.lon]} {...data} />
    </div>
  );
}
