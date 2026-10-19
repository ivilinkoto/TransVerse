'use client';

import { CreditCard, Crown, Loader2, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from '@/lib/client/api';
import { formatPlayPrice, isAndroidApp, playBillingService, playPurchase, type DigitalGoodsService } from '@/lib/client/android-app';
import { euro, type PaidProduct } from '@/lib/game/payments';

type PlayResult = { paymentId: string | null; status: string };
const noSubscribe = () => () => {};

/**
 * Real-money products: the player confirms the EU withdrawal notice, then pays
 * on the provider's page (PayPal / Stripe) — or, inside the Google Play app,
 * through Google Play Billing only (Play rules).
 */
export function BuyWithMoney({ products, testMode, providers, googlePlay = false }: { products: PaidProduct[]; testMode: boolean; providers: ('paypal' | 'stripe')[]; googlePlay?: boolean }) {
  const router = useRouter();
  const inApp = useSyncExternalStore(noSubscribe, isAndroidApp, () => false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Google Play: the billing service and its local prices (null while loading; false when not available).
  const [play, setPlay] = useState<{ service: DigitalGoodsService; prices: Record<string, string> } | false | null>(null);
  const ids = products.map((p) => p.id).join(',');

  useEffect(() => {
    if (!inApp || !googlePlay) return;
    let alive = true;
    (async () => {
      const service = await playBillingService();
      if (!alive) return;
      if (!service) return setPlay(false);
      const prices: Record<string, string> = {};
      try {
        for (const d of await service.getDetails(ids.split(','))) prices[d.itemId] = formatPlayPrice(d.price);
      } catch {
        // prices stay the list prices
      }
      if (!alive) return;
      setPlay({ service, prices });
      // A purchase paid but not delivered (app closed, no network): deliver it now.
      try {
        let delivered = 0;
        for (const p of await service.listPurchases()) {
          const r = await api<PlayResult>('/api/payments/google-play', { productId: p.itemId, purchaseToken: p.purchaseToken, consent: true }).catch(() => null);
          if (r?.status === 'paid') delivered++;
        }
        if (alive && delivered) {
          setNotice('Добавихме покупка от Google Play, която не беше доставена.');
          router.refresh();
        }
      } catch {
        // nothing to restore
      }
    })();
    return () => {
      alive = false;
    };
  }, [inApp, googlePlay, ids, router]);

  const buy = async (productId: string, provider: 'paypal' | 'stripe') => {
    setError(null);
    setBusy(`${productId}:${provider}`);
    try {
      const { url } = await api<{ url: string }>('/api/payments/checkout', { productId, provider, consent: true });
      window.location.assign(url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  const buyOnPlay = async (productId: string) => {
    setError(null);
    setNotice(null);
    setBusy(`${productId}:play`);
    try {
      // Refuse before Play takes money we could not deliver (e.g. unconfirmed e-mail).
      await api('/api/payments/google-play');
      const purchase = await playPurchase(productId);
      if (!purchase.token) throw new Error('Google Play не върна покупка.');
      try {
        const r = await api<PlayResult>('/api/payments/google-play', { productId, purchaseToken: purchase.token, consent: true });
        await purchase.complete(true);
        setNotice(r.status === 'paid' ? 'Плащането е получено — добавено към профила ти.' : 'Google Play обработва плащането. Ще бъде добавено, щом бъде потвърдено.');
        router.refresh();
      } catch (e) {
        await purchase.complete(false);
        throw e;
      }
    } catch (e) {
      const err = e as Error;
      // The player closed the Play sheet.
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  if (inApp && (!googlePlay || play === false)) {
    return (
      <p className="rounded-lg border border-asphalt-600 bg-asphalt-800 px-3 py-2 text-sm text-mist-300">
        {googlePlay ? 'Плащането през Google Play не е достъпно на това устройство. Обновете Google Chrome и Google Play Store и отворете приложението отново.' : 'Покупките в приложението от Google Play идват скоро. Дотогава ТрансКоин се получават от наградите в играта.'}
      </p>
    );
  }
  if (!inApp && !providers.length) {
    return <p className="rounded-lg border border-asphalt-600 bg-asphalt-800 px-3 py-2 text-sm text-mist-300">ТрансКоин и VIP се купуват в Android приложението TransVerse от Google Play.</p>;
  }

  return (
    <div>
      {testMode && !inApp && <p className="mb-3 rounded-lg border border-amber-sig/40 bg-amber-sig/10 px-3 py-2 text-xs text-amber-sig">Тестов режим — плащанията са с тестови (sandbox) сметки, не се теглят истински пари.</p>}
      <ul className="grid grid-cols-2 gap-3">
        {products.map((p) => (
          <li key={p.id} className={`flex flex-col rounded-xl border p-3 text-center ${p.vipDays ? 'border-gold-400/40 bg-gold-400/5' : 'border-asphalt-700'}`}>
            <div className={`num font-display text-xl font-bold ${p.vipDays ? 'text-gold-400' : 'text-cyan-glow'}`}>{p.vipDays ? <span className="inline-flex items-center gap-1"><Crown className="h-4 w-4" />VIP {p.vipDays} дни</span> : `${p.coins.toLocaleString('bg-BG')} TC`}</div>
            {p.bonus > 0 && <div className="text-xs text-profit">+{p.bonus} подарък</div>}
            <div className="num mt-1 text-sm text-mist-300">{inApp && play ? (play.prices[p.id] ?? euro(p.priceCents)) : euro(p.priceCents)}</div>
            <div className="mt-2 flex flex-col gap-1.5">
              {inApp ? (
                <button type="button" className="btn-primary justify-center px-3 py-1.5 text-sm" disabled={!consent || busy !== null || !play} onClick={() => buyOnPlay(p.id)} aria-label={`Купи ${p.label} през Google Play`}>
                  {busy === `${p.id}:play` || !play ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}Купи
                </button>
              ) : (
                <>
                  {providers.includes('paypal') && (
                    <button type="button" className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#ffc439] px-3 py-1.5 text-sm font-bold text-[#142c8e] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50" disabled={!consent || busy !== null} onClick={() => buy(p.id, 'paypal')} aria-label={`Плати ${p.label} с PayPal — ${euro(p.priceCents)}`}>
                      {busy === `${p.id}:paypal` && <Loader2 className="h-4 w-4 animate-spin" />}Плати с PayPal
                    </button>
                  )}
                  {providers.includes('stripe') && (
                    <button type="button" className="btn-primary justify-center px-3 py-1.5 text-sm" disabled={!consent || busy !== null} onClick={() => buy(p.id, 'stripe')} aria-label={`Плати ${p.label} с карта — ${euro(p.priceCents)}`}>
                      {busy === `${p.id}:stripe` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}Карта
                    </button>
                  )}
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      <label className="mt-3 flex items-start gap-2 text-xs text-mist-300">
        <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>Съгласен/на съм с <Link href="/terms" className="text-cyan-glow underline" target="_blank">Общите условия</Link> и искам доставката да започне веднага след плащането. Разбирам, че след като ТрансКоин / VIP бъдат добавени към профила ми, губя правото си на отказ в 14-дневен срок.</span>
      </label>
      {error && <p role="alert" className="mt-2 text-sm text-loss">{error}</p>}
      {notice && <p role="status" className="mt-2 text-sm text-profit">{notice}</p>}
      {inApp ? (
        <p className="mt-2 text-xs text-mist-400">Плащаш през Google Play — с карта, Google Play баланс или, където мобилният оператор го поддържа, с телефонната сметка. Цената е в местната валута на Google Play. ТрансКоин и VIP се добавят веднага след потвърждение.</p>
      ) : (
        <p className="mt-2 text-xs text-mist-400">{providers.includes('paypal') ? 'С PayPal плащаш от PayPal сметка или, където PayPal го позволява, с карта като гост. ' : ''}Плащането се извършва на защитената страница на платежния доставчик; данните за картата не минават през TransVerse. ТрансКоин и VIP се добавят автоматично веднага след потвърждение на плащането.</p>
      )}
    </div>
  );
}
