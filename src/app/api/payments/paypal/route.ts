import { NextResponse } from 'next/server';
import { getDb } from '@/server/db/client';
import { handlePaypalWebhook, PayPalError } from '@/server/payments';

export const dynamic = 'force-dynamic';

const HEADERS = ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'];

/**
 * PayPal webhook (optional; needs HTTPS and PAYPAL_WEBHOOK_ID). Not a player
 * request: every event is verified with PayPal before anything changes.
 */
export async function POST(request: Request) {
  let event;
  try {
    event = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const headers = Object.fromEntries(HEADERS.map((h) => [h, request.headers.get(h)]));
  try {
    const result = await handlePaypalWebhook(getDb(), headers, event);
    return NextResponse.json({ received: true, result });
  } catch (error) {
    if (error instanceof PayPalError && error.status === 400) return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
    console.error('[payments] paypal webhook failed', error);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
