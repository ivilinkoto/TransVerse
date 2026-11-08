import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GarageClient } from '@/components/garage/GarageClient';
import { Badge, PageHeader } from '@/components/ui';
import { HALL_TIERS } from '@/lib/game/garage';
import { isVip } from '@/lib/game/vip';
import { gameContext } from '@/server/game/context';
import { garageView } from '@/server/game/showroom';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Гараж') };
}

/** 1.2.3.5: the player's own trucks in a 3D hall, with the workshop at hand. */
export default async function ShowroomPage({ searchParams }: { searchParams: Promise<{ truck?: string }> }) {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.garage_showroom) notFound();
  const view = await garageView(db, user.id, user.id, now);
  if (!view) notFound();
  const { truck } = await searchParams;
  const next = HALL_TIERS.find((h) => h.tier === view.hall.tier + 1);
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('🏁 Гараж')}
        subtitle={t('Твоите камиони в хале: тунинг, подобрения, боя, ремонт, кабината отвътре и пробно каране.')}
        actions={<Badge tone="cyan">{tx(view.hall.label)}</Badge>}
      />
      {next && <p className="text-xs text-mist-400">{t('На ниво {0} халето става „{1}“ ({2} платформи).', next.minLevel, tx(next.label), next.platforms)}</p>}
      <GarageClient view={view} initialTruck={truck ?? null} isVip={isVip(user.vipUntil, now)} />
      {features.truck_contest && <p className="text-xs text-mist-400">{t('Харесва ти как изглежда?')} <Link href="/game/truck-contest" className="font-semibold text-cyan-glow hover:underline">{t('Пусни го в „Камион на месеца“ →')}</Link></p>}
    </div>
  );
}
