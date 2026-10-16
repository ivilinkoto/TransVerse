import { getDb } from '@/server/db/client';
import { handler } from '@/server/http';
import { checkoutSchema, createCheckout } from '@/server/payments';

/** Starts a Stripe Checkout for one product; the price always comes from the server. */
export const POST = handler({ schema: checkoutSchema, perMinute: 10 }, async ({ user, input }) => createCheckout(getDb(), user.id, input));
