import { z } from 'zod';
import { getDb } from '@/server/db/client';
import { handler } from '@/server/http';
import { confirmPaypalOrder } from '@/server/payments';

/** The buyer is back from PayPal: capture their own approved order and deliver it. */
export const POST = handler({ schema: z.object({ orderId: z.string().regex(/^[A-Z0-9]{5,40}$/, 'Невалидна поръчка.') }), perMinute: 20 }, async ({ user, input }) => {
  const payment = await confirmPaypalOrder(getDb(), input.orderId, { userId: user.id });
  return { status: payment?.status ?? 'unknown' };
});
