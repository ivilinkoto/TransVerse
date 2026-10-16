import { NextResponse } from 'next/server';
import { getDb } from '@/server/db/client';
import { handleStripeEvent, verifyWebhook } from '@/server/payments';

export const dynamic = 'force-dynamic';

/**
 * Stripe webhook. Not a player request: no session or same-origin check —
 * instead every call must carry Stripe's signature over the exact raw body.
 * A non-2xx answer makes Stripe retry, so only bad signatures get 400 and
 * our own failures get 500.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  let event;
  try {
    event = verifyWebhook(raw, request.headers.get('stripe-signature'));
  } catch {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
  }
  try {
    const result = await handleStripeEvent(getDb(), event);
    return NextResponse.json({ received: true, result });
  } catch (error) {
    console.error('[payments] webhook failed', event.type, event.id, error);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
