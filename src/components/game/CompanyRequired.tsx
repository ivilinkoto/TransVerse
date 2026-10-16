import { Building2, Lock } from 'lucide-react';
import Link from 'next/link';
import { money } from '@/lib/format';
import { ECONOMY } from '@/lib/game/economy';

/** Shown on company-only sections while the player is still an independent driver. */
export function CompanyRequired({ what }: { what: string }) {
  return (
    <div className="panel mx-auto mt-6 max-w-2xl p-8 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-prestige/15"><Lock className="h-6 w-6 text-prestige" /></span>
      <h2 className="mt-4 font-display text-xl font-bold">{what} изисква транспортна компания</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-mist-300">
        Камиони и депа можеш да купуваш и без компания. Наемането на шофьори е възможно, ако членуваш в компания на друг играч или основеш своя (ниво {ECONOMY.foundingMinLevel}, поне {ECONOMY.foundingMinDeliveries} доставки, такса {money(ECONOMY.foundingFeeCents)}).
      </p>
      <Link href="/game/company" className="btn-primary mt-6"><Building2 className="h-4 w-4" />Към основаването на компания</Link>
    </div>
  );
}
