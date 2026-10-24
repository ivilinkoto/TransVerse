import { Shield } from 'lucide-react';
import { LEAGUE_TIERS } from '@/lib/game/leagues';
import { t as tr, tx } from '@/i18n/t';

/** The weekly league a player plays in, as a coloured shield. */
export function LeagueBadge({ tier, size = 'sm' }: { tier: number; size?: 'sm' | 'md' }) {
  const t = LEAGUE_TIERS[Math.max(0, Math.min(LEAGUE_TIERS.length - 1, tier))]!;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border font-semibold ${size === 'md' ? 'px-2.5 py-1 text-sm' : 'px-2 py-0.5 text-[11px]'}`} style={{ borderColor: `${t.color}80`, color: t.color, background: `${t.color}1a` }} title={tr('Лига {0}', t.name)}>
      <Shield className={size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
      {tx(t.name)}
    </span>
  );
}
