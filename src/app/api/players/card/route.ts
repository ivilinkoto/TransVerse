import { z } from 'zod';
import { getDb } from '@/server/db/client';
import { fail } from '@/server/game/errors';
import { playerCard } from '@/server/game/social';
import { handler } from '@/server/http';

export const dynamic = 'force-dynamic';

/** The profile card of a player (by username). */
export const GET = handler({ perMinute: 120, schema: z.object({ u: z.string().trim().min(1).max(40) }) }, async ({ user, input }) => {
  const card = await playerCard(getDb(), user.id, input.u);
  if (!card) fail('player_not_found', 'Играчът не е намерен.', 404);
  return card;
});
