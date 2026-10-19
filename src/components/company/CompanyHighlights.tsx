import { Award, CalendarDays, Gavel, Hammer, History, MapPin, Medal, Route, Trophy, Truck, UserPlus, Weight } from 'lucide-react';
import Link from 'next/link';
import { PlayerName } from '@/components/game/PlayerName';
import { Card } from '@/components/ui';
import { date, int, km } from '@/lib/format';
import type { CompanyHighlights as Highlights } from '@/server/game/company-profile';

const HISTORY_ICON = { founded: CalendarDays, joined: UserPlus, tender: Gavel, season: Medal, project: Hammer } as const;

function Fact({ label, value, icon: Icon }: { label: string; value: React.ReactNode; icon: typeof Truck }) {
  return (
    <div className="rounded-xl bg-asphalt-850 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] text-mist-400"><Icon className="h-3.5 w-3.5" />{label}</div>
      <div className="num mt-0.5 font-display text-lg font-bold">{value}</div>
    </div>
  );
}

/** Totals, live activity, records and history of a company (its public page). */
export function CompanyHighlights({ h }: { h: Highlights }) {
  return (
    <>
      <Card title={<span className="inline-flex items-center gap-2"><Trophy className="h-4 w-4 text-gold-400" />Компанията в числа</span>} actions={<span className="text-xs text-mist-400">от курсовете на сегашните членове</span>}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Fact label="Основана" value={date(h.foundedAt)} icon={CalendarDays} />
          <Fact label="Седалище" value={h.hq} icon={MapPin} />
          <Fact label="Ниво на компанията" value={h.level} icon={Award} />
          <Fact label="Курсове" value={int(h.trips)} icon={Truck} />
          <Fact label="Изминати" value={km(h.km)} icon={Route} />
          <Fact label="Превозени" value={`${int(h.tons)} т`} icon={Weight} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-asphalt-700 px-3 py-2 text-sm">
          <span className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${h.online ? 'bg-profit' : 'bg-asphalt-500'}`} />{h.online} {h.online === 1 ? 'член е' : 'члена са'} в играта сега</span>
          <span className="flex items-center gap-1.5"><Truck className="h-4 w-4 text-cyan-glow" />{h.onRoad} {h.onRoad === 1 ? 'камион е' : 'камиона са'} на път</span>
          <Link href="/game/map" className="ml-auto text-cyan-glow hover:underline">На картата →</Link>
        </div>
      </Card>

      <Card title={<span className="inline-flex items-center gap-2"><Medal className="h-4 w-4 text-gold-400" />Рекорди</span>}>
        {!h.longest && !h.weekly.length ? (
          <p className="text-sm text-mist-400">Рекордите се появяват след първите курсове на членовете.</p>
        ) : (
          <div className="space-y-3 text-sm">
            {h.longest && (
              <div className="flex items-start gap-3">
                <Route className="mt-0.5 h-4 w-4 shrink-0 text-cyan-glow" />
                <div className="min-w-0"><div>Най-дълъг курс: <span className="num font-semibold">{km(h.longest.km)}</span></div><div className="truncate text-xs text-mist-400"><PlayerName name={h.longest.player} /> · {h.longest.from} → {h.longest.to}</div></div>
              </div>
            )}
            {h.heaviest && (
              <div className="flex items-start gap-3">
                <Weight className="mt-0.5 h-4 w-4 shrink-0 text-amber-sig" />
                <div className="min-w-0"><div>Най-тежък товар: <span className="num font-semibold">{int(Math.round(h.heaviest.tons))} т</span> {h.heaviest.goods.toLowerCase()}</div><div className="truncate text-xs text-mist-400"><PlayerName name={h.heaviest.player} /> · {h.heaviest.from} → {h.heaviest.to}</div></div>
              </div>
            )}
            {h.weekly.length > 0 && (
              <div className="border-t border-asphalt-800 pt-3">
                <div className="label mb-2">Шофьори на седмицата</div>
                <ol className="space-y-1.5">
                  {h.weekly.map((w, i) => (
                    <li key={w.player} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2"><span className={`num w-4 text-center font-bold ${i === 0 ? 'text-gold-400' : 'text-mist-400'}`}>{i + 1}</span><PlayerName name={w.player} /></span>
                      <span className="num text-xs text-mist-400">{w.trips} {w.trips === 1 ? 'курс' : 'курса'} · {km(w.km)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card title={<span className="inline-flex items-center gap-2"><History className="h-4 w-4 text-mist-400" />История</span>}>
        <ol className="relative space-y-3 border-l border-asphalt-700 pl-4 text-sm">
          {h.history.map((e, i) => {
            const Icon = HISTORY_ICON[e.kind];
            return (
              <li key={`${e.kind}-${i}`} className="relative">
                <span className="absolute -left-[25px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-asphalt-900 ring-1 ring-asphalt-600"><Icon className="h-2.5 w-2.5 text-mist-300" /></span>
                <div>{e.text}</div>
                {e.at && <div className="text-xs text-mist-400">{date(e.at)}</div>}
              </li>
            );
          })}
        </ol>
      </Card>
    </>
  );
}
