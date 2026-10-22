import { Snowflake } from 'lucide-react';
import { CONDITION_LABELS, roadCondition, type RealConditions, type RoadCondition, WINTER } from '@/lib/game/winter';

const TONE: Record<RoadCondition, string> = { clear: 'text-profit', snow: 'text-volt-400', ice: 'text-amber-sig', blizzard: 'text-loss' };

/** Today's road condition in every country (the real weather when there is a reading, v1.4; else game data), with a reminder about winter tyres. */
export function RoadConditions({ countries, now, real = null }: { countries: { code: string; nameBg: string }[]; now: Date; real?: RealConditions | null }) {
  const rows = countries.map((c) => ({ ...c, condition: roadCondition(c.code, now, real) }));
  return (
    <section className="panel border-cyan-glow/30 p-4" aria-label="Пътна обстановка днес">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display font-bold"><Snowflake className="h-5 w-5 text-cyan-glow" />Пътна обстановка днес</h2>
        <span className="text-xs text-mist-400">{real ? 'реалното време сега · Open-Meteo.com (CC BY 4.0)' : 'игрови данни · сменя се всеки ден'}</span>
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
        {rows.map((r) => (
          <li key={r.code} className="flex items-center justify-between gap-2">
            <span className="truncate">{r.nameBg}</span>
            <span className={`shrink-0 text-xs font-semibold ${TONE[r.condition]}`}>{r.condition === 'blizzard' ? 'Виелица' : CONDITION_LABELS[r.condition]}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-mist-400">
        Сняг, лед и затворени проходи бавят курса, а на поледица камионът може да излезе от пътя. Зимните гуми (Сервиз) намаляват наполовина и шанса, и забавянето; наетите камиони вече са с тях. Зимните товари плащат +{Math.round((WINTER.rewardMultiplier - 1) * 100)}%.
      </p>
    </section>
  );
}
