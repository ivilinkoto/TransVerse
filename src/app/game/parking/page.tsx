import { and, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { ParkingGame } from '@/components/game/ParkingGame';
import { Card, PageHeader } from '@/components/ui';
import { dayKey } from '@/lib/game/daily';
import { PARKING } from '@/lib/game/parking';
import { jobState } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';

export const metadata = { title: 'Паркирай на рампата' };

export default async function ParkingPage() {
  const { db, user, now, features } = await gameContext();
  if (!features.parking_game) notFound();
  const day = dayKey(now);
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(and(eq(jobState.key, `parking:${user.id}:${day}`)));
  return (
    <div className="space-y-6">
      <PageHeader title="Паркирай на рампата" subtitle="Веднъж на ден: камионът върви назад, ти завиваш. Колкото по-точно спреш на рампата, толкова повече опит." />
      <Card>
        <ParkingGame day={day} played={row ? { stars: Number((row.value as { stars?: number }).stars ?? 0) } : null} />
        <p className="mt-3 text-xs text-mist-400">Звезди: ⭐ до {PARKING.stars[2]!.maxDist} м и {Math.round((PARKING.stars[2]!.maxAngle * 180) / Math.PI)}°, ⭐⭐ до {PARKING.stars[1]!.maxDist} м, ⭐⭐⭐ до {PARKING.stars[0]!.maxDist} м и {Math.round((PARKING.stars[0]!.maxAngle * 180) / Math.PI)}° · опит {PARKING.xp.slice(1).join(' / ')}.</p>
      </Card>
    </div>
  );
}
