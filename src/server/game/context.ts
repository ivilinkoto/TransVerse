import { redirect } from 'next/navigation';
import { cache } from 'react';
import { liveFeatures } from '@/lib/game/features';
import { isStaff } from '@/server/auth/roles';
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
  // Read the player again only when an arrival just changed the balance.
  const fresh = (await settleDueDeliveries(db, new Date(), base.company.id)) ? await userWithCompany(db, user.id) : base;
  // One timestamp per request keeps every page render consistent (and pure).
  const now = new Date();
  // Features of an update that is not out yet are on only for staff (to test them).
  return { db, user: fresh.user, company: fresh.company, hq: fresh.hq, now, features: liveFeatures(now, isStaff(fresh.user.role)) };
});
