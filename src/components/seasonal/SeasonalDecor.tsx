import type { SeasonId } from '@/lib/game/seasonal';
import { BatIcon, Cobweb } from './icons';

/** Decorations of a season: fixed, behind nothing important, ignored by screen readers and clicks. */
export function SeasonalDecor({ season }: { season: SeasonId }) {
  if (season !== 'halloween') return null;
  return (
    <div className="season-decor pointer-events-none fixed inset-0 z-[5] overflow-hidden" aria-hidden="true">
      <Cobweb className="absolute -left-1 -top-1 h-24 w-24 text-white/10 sm:h-32 sm:w-32" />
      <Cobweb className="absolute -right-1 -top-1 h-24 w-24 -scale-x-100 text-white/10 sm:h-32 sm:w-32" />
      {[0, 1, 2].map((i) => (
        <span key={i} className={`season-bat season-bat-${i} absolute text-[#4c2a63]`}>
          <BatIcon className="h-5 w-10 drop-shadow-[0_0_6px_rgba(249,115,22,0.35)]" />
        </span>
      ))}
      <div className="season-fog absolute inset-x-0 bottom-0 h-40" />
    </div>
  );
}
