import { z } from 'zod';
import { getDb } from '@/server/db/client';
import { handler } from '@/server/http';
import { isStaff } from '@/server/auth/roles';
import { recordPageView } from '@/server/page-views';

/** 1.2.1.1: a page of the game was opened (counted per day, for the team's page report). Staff are not counted. */
export const POST = handler({ schema: z.object({ path: z.string().max(200) }), perMinute: 120 }, async ({ user, input }) => {
  if (!isStaff(user.role)) await recordPageView(getDb(), user.id, input.path);
  return { ok: true };
});
