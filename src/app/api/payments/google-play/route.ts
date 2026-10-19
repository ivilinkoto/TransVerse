import { getDb } from '@/server/db/client';
import { handler } from '@/server/http';
import { assertCanBuy, paymentConfig, playPurchaseSchema, verifyPlayPurchase } from '@/server/payments';
import { fail } from '@/server/game/errors';

/** Before opening Google Play: may this player buy at all? (so nothing is charged that we would refuse) */
export const GET = handler({ perMinute: 30 }, async ({ user }) => {
  if (!paymentConfig().googlePlay.enabled) fail('payments_disabled', 'Плащанията през Google Play още не са включени.', 503);
  await assertCanBuy(getDb(), user.id);
  return { ok: true };
});

/** Google Play took the money: check the purchase with Google, deliver once and consume it. */
export const POST = handler({ schema: playPurchaseSchema, perMinute: 30 }, async ({ user, input }) => verifyPlayPurchase(getDb(), user.id, input));
