'use client';

/**
 * The Google Play app opens the site with ?app=android (and an android-app://
 * referrer). We remember it for the session of that app window: inside it,
 * real-money purchases must go through Google Play Billing.
 */
const KEY = 'tv-android-app';
export const PLAY_BILLING = 'https://play.google.com/billing';

export function markAndroidApp() {
  try {
    const fromApp = new URLSearchParams(window.location.search).get('app') === 'android' || document.referrer.startsWith('android-app://');
    if (fromApp) window.sessionStorage.setItem(KEY, '1');
  } catch {
    // storage blocked — the app falls back to the URL flag
  }
}

export function isAndroidApp(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === '1' || new URLSearchParams(window.location.search).get('app') === 'android';
  } catch {
    return false;
  }
}

/** Digital Goods API (Chrome, inside a Trusted Web Activity from Google Play). */
export interface DigitalGoodsService {
  getDetails(itemIds: string[]): Promise<{ itemId: string; title: string; price: { currency: string; value: string } }[]>;
  listPurchases(): Promise<{ itemId: string; purchaseToken: string }[]>;
}

export async function playBillingService(): Promise<DigitalGoodsService | null> {
  const w = window as Window & { getDigitalGoodsService?: (provider: string) => Promise<DigitalGoodsService | null> };
  if (typeof w.getDigitalGoodsService !== 'function' || typeof window.PaymentRequest !== 'function') return null;
  try {
    return await w.getDigitalGoodsService(PLAY_BILLING);
  } catch {
    return null;
  }
}

/** Opens the Google Play purchase sheet; returns the purchase token and a way to close the sheet. */
export async function playPurchase(itemId: string) {
  const request = new PaymentRequest([{ supportedMethods: PLAY_BILLING, data: { sku: itemId } }], { total: { label: 'Total', amount: { currency: 'EUR', value: '0' } } });
  const response = await request.show();
  const token = (response.details as { purchaseToken?: string }).purchaseToken;
  return { token: token ?? null, complete: (ok: boolean) => response.complete(ok ? 'success' : 'fail').catch(() => undefined) };
}

export const formatPlayPrice = (price: { currency: string; value: string }) => {
  try {
    return new Intl.NumberFormat('bg-BG', { style: 'currency', currency: price.currency }).format(Number(price.value));
  } catch {
    return `${price.value} ${price.currency}`;
  }
};
