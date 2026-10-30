import { notFound, redirect } from 'next/navigation';
import { gameContext } from '@/server/game/context';
import { sameLaneAgain } from '@/server/game/overview';

export const dynamic = 'force-dynamic';

/** 1.1.3: "Същия курс отново" — to an open load on the lane of a finished trip, else to the board. */
export default async function SameTripAgain({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { db, user, company, now, features } = await gameContext();
  const again = await sameLaneAgain(db, company.id, user.id, id, now);
  if (!again) notFound();
  // 1.1.3.5: the lane's loads with the same truck first — also when none is open right now.
  if (features.repeat_trip) {
    const q = new URLSearchParams({ repeat: `${again.originCityId}-${again.destCityId}` });
    if (again.vehicleId) q.set('truck', again.vehicleId);
    if (again.loadId) q.set('load', again.loadId);
    redirect(`/game/contracts?${q}`);
  }
  redirect(again.loadId ? `/game/contracts?load=${again.loadId}` : '/game/contracts');
}
