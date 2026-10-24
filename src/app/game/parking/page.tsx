import { and, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { ParkingGame } from '@/components/game/ParkingGame';
import { Card, PageHeader } from '@/components/ui';
import { dayKey } from '@/lib/game/daily';
import { PARKING } from '@/lib/game/parking';
import { jobState } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Паркирай на рампата') };
}

export default async function ParkingPage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.parking_game) notFound();
  const day = dayKey(now);
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(and(eq(jobState.key, `parking:${user.id}:${day}`)));
  return (
    <div className="space-y-6">
      <PageHeader title={t('Паркирай на рампата')} subtitle={t('Веднъж на ден: камионът върви назад, ти завиваш. Колкото по-точно спреш на рампата, толкова повече опит.')} />
      <Card>
        <ParkingGame day={day} played={row ? { stars: Number((row.value as { stars?: number }).stars ?? 0) } : null} />
        <p className="mt-3 text-xs text-mist-400">{t('Звезди: ⭐ до {0} м и {1}°, ⭐⭐ до {2} м, ⭐⭐⭐ до {3} м и {4}° · опит {5}.', PARKING.stars[2]!.maxDist, Math.round((PARKING.stars[2]!.maxAngle * 180) / Math.PI), PARKING.stars[1]!.maxDist, PARKING.stars[0]!.maxDist, Math.round((PARKING.stars[0]!.maxAngle * 180) / Math.PI), PARKING.xp.slice(1).join(' / '))}</p>
      </Card>
    </div>
  );
}
