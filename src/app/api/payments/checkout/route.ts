import { getDb } from '@/server/db/client';
import { handler } from '@/server/http';
import { checkoutSchema, createCheckout, createPaypalCheckout } from '@/server/payments';

/** Starts a checkout with the chosen provider; the price always comes from the server. */
export const POST = handler({ schema: checkoutSchema, perMinute: 10 }, async ({ user, input, request }) => {
  // The origin was already checked to be this site (same-origin guard in handler).
  const origin = request.headers.get('origin');
  return input.provider === 'stripe' ? createCheckout(getDb(), user.id, input, undefined, new Date(), origin) : createPaypalCheckout(getDb(), user.id, input, undefined, new Date(), origin);
});
