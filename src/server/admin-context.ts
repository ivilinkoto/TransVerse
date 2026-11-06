import { redirect } from 'next/navigation';
import { cache } from 'react';
import { isAdmin, isStaff } from '@/server/auth/roles';
import { getDb } from '@/server/db/client';
import { currentUser } from '@/server/http';

/** Staff-only request context for /admin pages. Players are sent back to the game. */
export const adminContext = cache(async (opts?: { admin?: boolean }) => {
  const user = await currentUser();
  if (!user) redirect('/login?next=/admin');
  if (!isStaff(user.role)) redirect('/game');
  // 1.2.3.1: the administrators' pages send support staff back to the dashboard.
  if (opts?.admin && !isAdmin(user.role)) redirect('/admin');
  // One timestamp per request keeps renders pure.
  return { db: getDb(), user, now: new Date() };
});
