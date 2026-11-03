import { redirect } from 'next/navigation';
import { cache } from 'react';
import { liveFeatures } from '@/lib/game/features';
import { oldMenuOffered } from '@/lib/game/nav-choice';
import { testsUnreleased } from '@/server/auth/roles';
import { getDb } from '@/server/db/client';
import { disabledFeatures, withSwitches } from '@/server/feature-switches';
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
  // 1.1.4.1: a feature the administrators switched off is off for the players.
  const testing = testsUnreleased(fresh.user);
  const features = withSwitches(liveFeatures(now, testing), await disabledFeatures(db), testing);
  // 1.2.2: a player who chose the old menu keeps it for the two weeks it is offered.
  if (features.nav_v2 && fresh.user.uiPrefs?.oldMenu && oldMenuOffered(now)) features.nav_v2 = false;
  return { db, user: fresh.user, company: fresh.company, hq: fresh.hq, now, features };
});
