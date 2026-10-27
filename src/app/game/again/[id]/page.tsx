import { notFound, redirect } from 'next/navigation';
import { gameContext } from '@/server/game/context';
import { sameLaneAgain } from '@/server/game/overview';

export const dynamic = 'force-dynamic';

/** 1.1.3: "Същия курс отново" — to an open load on the lane of a finished trip, else to the board. */
export default async function SameTripAgain({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { db, user, company, now } = await gameContext();
  const again = await sameLaneAgain(db, company.id, user.id, id, now);
  if (!again) notFound();
  redirect(again.loadId ? `/game/contracts?load=${again.loadId}` : '/game/contracts');
}
