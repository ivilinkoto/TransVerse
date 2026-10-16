import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getDb } from '@/server/db/client';
import { currentUser } from '@/server/http';
import { userWithCompany } from './company';
import { settleDueDeliveries } from './deliveries';

/**
 * Per-request game context for /game pages. Redirects anonymous visitors and
 * settles any of the player's deliveries that arrived in the meantime, so the
 * page is correct even if the background worker is behind.
 */
export const gameContext = cache(async () => {
  const user = await currentUser();
  if (!user) redirect('/login');
  const db = getDb();
  const base = await userWithCompany(db, user.id);
  await settleDueDeliveries(db, new Date(), base.company.id);
  const fresh = await userWithCompany(db, user.id);
  return { db, user: fresh.user, company: fresh.company, hq: fresh.hq };
});
