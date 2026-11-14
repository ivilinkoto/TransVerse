import { z } from 'zod';
import { isStaff } from '@/server/auth/roles';
import { getDb } from '@/server/db/client';
import { handler } from '@/server/http';
import { noteVisit, startVisitFlush } from '@/server/page-visits';

/** A page of the game was opened (Админ → Използване). The staff are not counted. */
export const POST = handler({ schema: z.object({ path: z.string().max(200) }), perMinute: 120 }, async ({ user, input }) => {
  if (!isStaff(user.role)) {
    startVisitFlush(getDb);
    noteVisit(user.id, input.path);
  }
  return { ok: true };
});
