import type { SeasonId } from '@/lib/game/seasonal';
import { BatIcon, Cobweb } from './icons';

const LIGHTS = ['#ef4444', '#facc15', '#22c55e', '#38bdf8'];

/** Decorations of a season: fixed, behind nothing important, ignored by screen readers and clicks. */
export function SeasonalDecor({ season }: { season: SeasonId }) {
  if (season === 'winter' || season === 'christmas') {
    // Light snowfall: a few flakes with their own size, place and speed (CSS only). At Christmas also a string of lights.
    return (
      <div className="season-decor pointer-events-none fixed inset-0 z-[5] overflow-hidden" aria-hidden="true">
        {season === 'christmas' && (
          <div className="absolute inset-x-0 top-0 flex justify-around px-2">
            {Array.from({ length: 18 }, (_, i) => (
              <span key={i} className="season-light mt-0.5 h-1.5 w-1.5 rounded-full" style={{ background: LIGHTS[i % LIGHTS.length], boxShadow: `0 0 8px ${LIGHTS[i % LIGHTS.length]}`, animationDelay: `${-(i % 6) * 0.4}s` }} />
            ))}
          </div>
        )}
        {Array.from({ length: 24 }, (_, i) => (
          <span key={i} className="season-flake absolute top-0 rounded-full bg-white" style={{ left: `${(i * 37) % 100}%`, width: 2 + (i % 4), height: 2 + (i % 4), opacity: 0.25 + (i % 5) * 0.1, animationDuration: `${11 + (i % 7) * 2}s`, animationDelay: `${-(i * 1.7) % 19}s` }} />
        ))}
        <div className="season-frost absolute inset-x-0 top-0 h-24" />
      </div>
    );
  }
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
