'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { api } from '@/lib/client/api';

/** Back from PayPal: asks our server to capture the approved order, then shows the result. */
export function PaypalReturn({ orderId }: { orderId: string }) {
  const router = useRouter();
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    api('/api/payments/paypal/capture', { orderId })
      .catch(() => undefined)
      .finally(() => router.refresh());
  }, [orderId, router]);
  return null;
}
