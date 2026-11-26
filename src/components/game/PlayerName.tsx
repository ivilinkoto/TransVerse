'use client';

import { hasVipTag, vipLabel, type VipTag } from '@/lib/game/vip';
import { Crown, ShieldCheck } from 'lucide-react';
import { t, tx } from '@/i18n/t';
import { useViewerStaff } from '@/components/game/Features';

const STAFF_SHORT: Record<string, string> = { founder: 'Основател', admin: 'Админ', support: 'Поддръжка' };

/** Opens the profile card of a player (handled by PlayerCardHost in the game layout). */
export function openPlayerCard(username: string) {
  window.dispatchEvent(new CustomEvent('tv:player', { detail: { username } }));
}

/** A player's name with their badges: staff role and VIP. Clicking it opens their profile card. */
export function PlayerName({ name, role, vip, className = '', card = true }: { name: string; role?: string | null; vip?: VipTag | boolean; className?: string; card?: boolean }) {
  // v1.1.2: the staff badge is for the staff only; players see a plain name.
  const viewerStaff = useViewerStaff();
  const staff = viewerStaff && role ? tx(STAFF_SHORT[role]) : undefined;
  // 1.3.3: the badge shows the VIP level (VIP1–VIP5), or plain VIP for VIP time without a level.
  const isVipNow = hasVipTag(vip);
  const label = <span className={isVipNow ? 'font-semibold text-gold-400' : undefined}>{name}</span>;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}>
      {card ? (
        <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); openPlayerCard(name); }} className="cursor-pointer text-left underline-offset-2 hover:underline focus-visible:underline" title={t('Профил на {0}', name)}>
          {label}
        </button>
      ) : label}
      {staff && (
        <span className="inline-flex items-center gap-0.5 rounded-full border border-prestige/40 bg-prestige/10 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-prestige" title={staff}>
          <ShieldCheck className="h-3 w-3" />{staff}
        </span>
      )}
      {isVipNow && (
        <span className="inline-flex items-center gap-0.5 rounded-full border border-gold-400/50 bg-gold-400/15 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-gold-400" title={typeof vip === 'number' && vip > 0 ? t('VIP ниво {0}', vip) : t('VIP играч')} data-testid="vip-badge">
          <Crown className="h-3 w-3" />{vipLabel(vip)}
        </span>
      )}
    </span>
  );
}
