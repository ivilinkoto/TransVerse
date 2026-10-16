import { redirect } from 'next/navigation';
import { cache } from 'react';
import { isStaff } from '@/server/auth/roles';
import { getDb } from '@/server/db/client';
import { currentUser } from '@/server/http';

/** Staff-only request context for /admin pages. Players are sent back to the game. */
export const adminContext = cache(async () => {
  const user = await currentUser();
  if (!user) redirect('/login?next=/admin');
  if (!isStaff(user.role)) redirect('/game');
  // One timestamp per request keeps renders pure.
  return { db: getDb(), user, now: new Date() };
});
