'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Ticket } from 'lucide-react';
import { api } from '@/lib/client/api';
import { ITEMS, type ItemId } from '@/lib/game/items';
import { money, int } from '@/lib/format';
import type { PromoReward } from '@/lib/game/promo';
import { motionEnabled, playReveal } from '@/lib/client/motion';
import { burst, coinsEl, flyTo, walletEl } from '@/components/fx/fx';
import { useFeature } from './Features';
import { t, tx } from '@/i18n/t';

const rewardLine = (r: PromoReward) =>
  [
    r.coins ? `+${int(r.coins)} TC` : '',
    r.cents ? `+${money(r.cents)}` : '',
    r.vipDays ? t('+{0} VIP дни', r.vipDays) : '',
    ...(r.items ?? []).map((i) => `${tx(ITEMS[i.itemId as ItemId]?.name ?? i.itemId)} ×${i.qty}`),
  ].filter(Boolean).join(' · ');

/** 1.1.4.3: „Имаш код?“ — a promo code or a friend's invite code. */
export function PromoRedeem({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const fx = useFeature('game_fx');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await api<{ kind: 'promo' | 'invite'; code: string; reward: PromoReward; inviter?: string }>('/api/game/action', { type: 'redeemCode', code });
      setDone(r.kind === 'invite' ? t('Записан си като поканен от {0}. Получаваш {1}.', r.inviter ?? '', rewardLine(r.reward)) : t('Кодът {0} е твой: {1}', r.code, rewardLine(r.reward)));
      setCode('');
      if (fx && motionEnabled() && box.current) {
        playReveal(2);
        burst(box.current, { count: 40, spread: 180 });
        if (r.reward.coins) flyTo(box.current, coinsEl(), '🪙', 6);
        if (r.reward.cents) flyTo(box.current, walletEl(), '💰', 6);
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div ref={box} className="space-y-2">
      {!compact && <p className="text-sm text-mist-300">{t('Промокод от Facebook, Discord или турнир — или кодът на приятел, който те покани (до 7 дни след регистрацията).')}</p>}
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <input className="input min-w-0 flex-1 font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('напр. BUDITELI2026')} maxLength={40} autoComplete="off" spellCheck={false} aria-label={t('Промокод')} />
        <button type="submit" className="btn-gold" disabled={busy || code.trim().length < 4}><Ticket className="h-4 w-4" />{busy ? '…' : t('Вземи')}</button>
      </form>
      {done && <p role="status" className="rounded-xl border border-profit/40 bg-profit/10 p-2 text-sm font-semibold text-profit">🎉 {done}</p>}
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
    </div>
  );
}
