'use client';

import { CreditCard, Crown, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { euro, type PaidProduct } from '@/lib/game/payments';

/** Real-money products: the player confirms the EU withdrawal notice, then pays on Stripe's page. */
export function BuyWithMoney({ products, testMode }: { products: PaidProduct[]; testMode: boolean }) {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const buy = async (productId: string) => {
    setError(null);
    setBusy(productId);
    try {
      const { url } = await api<{ url: string }>('/api/payments/checkout', { productId, consent: true });
      window.location.assign(url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div>
      {testMode && <p className="mb-3 rounded-lg border border-amber-sig/40 bg-amber-sig/10 px-3 py-2 text-xs text-amber-sig">Тестов режим на Stripe — не се теглят истински пари.</p>}
      <ul className="grid grid-cols-2 gap-3">
        {products.map((p) => (
          <li key={p.id} className={`flex flex-col rounded-xl border p-3 text-center ${p.vipDays ? 'border-gold-400/40 bg-gold-400/5' : 'border-asphalt-700'}`}>
            <div className={`num font-display text-xl font-bold ${p.vipDays ? 'text-gold-400' : 'text-cyan-glow'}`}>{p.vipDays ? <span className="inline-flex items-center gap-1"><Crown className="h-4 w-4" />VIP {p.vipDays} дни</span> : `${p.coins.toLocaleString('bg-BG')} TC`}</div>
            {p.bonus > 0 && <div className="text-xs text-profit">+{p.bonus} подарък</div>}
            <div className="num mt-1 text-sm text-mist-300">{euro(p.priceCents)}</div>
            <button type="button" className="btn-primary mt-2 justify-center px-3 py-1.5 text-sm" disabled={!consent || busy !== null} onClick={() => buy(p.id)} aria-label={`Купи ${p.label} за ${euro(p.priceCents)}`}>
              {busy === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}Купи
            </button>
          </li>
        ))}
      </ul>
      <label className="mt-3 flex items-start gap-2 text-xs text-mist-300">
        <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>Съгласен/на съм с <Link href="/terms" className="text-cyan-glow underline" target="_blank">Общите условия</Link> и искам доставката да започне веднага след плащането. Разбирам, че след като ТрансКоин / VIP бъдат добавени към профила ми, губя правото си на отказ в 14-дневен срок.</span>
      </label>
      {error && <p role="alert" className="mt-2 text-sm text-loss">{error}</p>}
      <p className="mt-2 text-xs text-mist-400">Плащането се извършва на защитената страница на Stripe (карта, PayPal, Apple Pay, Google Pay — според наличното). Данните за картата не минават през TransVerse. ТрансКоин и VIP се добавят автоматично веднага след потвърждение на плащането.</p>
    </div>
  );
}
