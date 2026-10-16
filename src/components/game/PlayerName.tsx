import { Crown, ShieldCheck } from 'lucide-react';

const STAFF_SHORT: Record<string, string> = { founder: 'Основател', admin: 'Админ', support: 'Поддръжка' };

/** A player's name with their badges: staff role and VIP. */
export function PlayerName({ name, role, vip, className = '' }: { name: string; role?: string | null; vip?: boolean; className?: string }) {
  const staff = role ? STAFF_SHORT[role] : undefined;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}>
      <span>{name}</span>
      {staff && (
        <span className="inline-flex items-center gap-0.5 rounded-full border border-prestige/40 bg-prestige/10 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-prestige" title={staff}>
          <ShieldCheck className="h-3 w-3" />{staff}
        </span>
      )}
      {vip && (
        <span className="inline-flex items-center gap-0.5 rounded-full border border-gold-400/50 bg-gold-400/15 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-gold-400" title="VIP играч">
          <Crown className="h-3 w-3" />VIP
        </span>
      )}
    </span>
  );
}
