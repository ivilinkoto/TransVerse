'use client';

import { CreditCard, Crown, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { euro, type PaidProduct } from '@/lib/game/payments';
import { t, intlLocale } from '@/i18n/t';

/** Real-money products: the player confirms the EU withdrawal notice, then pays on Stripe's page. */
export function BuyWithMoney({ products, testMode, providers }: { products: PaidProduct[]; testMode: boolean; providers: ('paypal' | 'stripe')[] }) {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div>
      {testMode && <p className="mb-3 rounded-lg border border-amber-sig/40 bg-amber-sig/10 px-3 py-2 text-xs text-amber-sig">{t('Тестов режим — плащанията са с тестови (sandbox) сметки, не се теглят истински пари.')}</p>}
      <ul className="grid grid-cols-2 gap-3">
        {products.map((p) => (
          <li key={p.id} className={`flex flex-col rounded-xl border p-3 text-center ${p.vipDays ? 'border-gold-400/40 bg-gold-400/5' : 'border-asphalt-700'}`}>
            <div className={`num font-display text-xl font-bold ${p.vipDays ? 'text-gold-400' : 'text-cyan-glow'}`}>{p.vipDays ? <span className="inline-flex items-center gap-1"><Crown className="h-4 w-4" />{t('VIP {0} дни', p.vipDays)}</span> : `${p.coins.toLocaleString(intlLocale())} TC`}</div>
            {p.bonus > 0 && <div className="text-xs text-profit">{t('+{0} подарък', p.bonus)}</div>}
            <div className="num mt-1 text-sm text-mist-300">{euro(p.priceCents)}</div>
            <div className="mt-2 flex flex-col gap-1.5">
              {providers.includes('paypal') && (
                <button type="button" className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#ffc439] px-3 py-1.5 text-sm font-bold text-[#142c8e] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50" disabled={!consent || busy !== null} onClick={() => buy(p.id, 'paypal')} aria-label={t('Плати {0} с PayPal — {1}', p.label, euro(p.priceCents))}>
                  {busy === `${p.id}:paypal` && <Loader2 className="h-4 w-4 animate-spin" />}{t('Плати с PayPal')}
                </button>
              )}
              {providers.includes('stripe') && (
                <button type="button" className="btn-primary justify-center px-3 py-1.5 text-sm" disabled={!consent || busy !== null} onClick={() => buy(p.id, 'stripe')} aria-label={t('Плати {0} с карта — {1}', p.label, euro(p.priceCents))}>
                  {busy === `${p.id}:stripe` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}{t('Карта')}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <label className="mt-3 flex items-start gap-2 text-xs text-mist-300">
        <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>{t('Съгласен/на съм с')}{' '}<Link href="/terms" className="text-cyan-glow underline" target="_blank">{t('Общите условия')}</Link>{' '}{t('и искам доставката да започне веднага след плащането. Разбирам, че след като ТрансКоин / VIP бъдат добавени към профила ми, губя правото си на отказ в 14-дневен срок.')}</span>
      </label>
      {error && <p role="alert" className="mt-2 text-sm text-loss">{error}</p>}
      <p className="mt-2 text-xs text-mist-400">{t('{0}Плащането се извършва на защитената страница на платежния доставчик; данните за картата не минават през TransVerse. ТрансКоин и VIP се добавят автоматично веднага след потвърждение на плащането.', providers.includes('paypal') ? t('С PayPal плащаш от PayPal сметка или, където PayPal го позволява, с карта като гост. ') : '')}</p>
    </div>
  );
}
