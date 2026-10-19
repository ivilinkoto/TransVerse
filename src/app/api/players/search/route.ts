import { z } from 'zod';
import { getDb } from '@/server/db/client';
import { requireFeature } from '@/server/features';
import { searchPlayers } from '@/server/game/search';
import { handler } from '@/server/http';

export const dynamic = 'force-dynamic';

/** Player and company search for the top bar. */
export const GET = handler({ perMinute: 90, schema: z.object({ q: z.string().max(40).default('') }) }, async ({ user, input }) => {
  requireFeature('search', user.role);
  return searchPlayers(getDb(), input.q);
});
