import { z } from 'zod';
import { getDb } from '@/server/db/client';
import { handler } from '@/server/http';
import { subscribe, subscriptionSchema, unsubscribe } from '@/server/push';

/** Saves this browser's push subscription for the signed-in player. */
export const POST = handler({ schema: subscriptionSchema, perMinute: 20 }, async ({ user, input, request }) => {
  await subscribe(getDb(), user.id, input, request.headers.get('user-agent'));
  return { ok: true };
});

/** Stops push notifications on this browser. */
export const DELETE = handler({ schema: z.object({ endpoint: z.string().url().max(1000) }), perMinute: 20 }, async ({ user, input }) => {
  await unsubscribe(getDb(), user.id, input.endpoint);
  return { ok: true };
});
