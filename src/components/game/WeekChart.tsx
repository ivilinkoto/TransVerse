import type { WeekDay } from '@/server/game/week-chart';
import { money } from '@/lib/format';
import { intlLocale, t } from '@/i18n/t';

/** 1.2.3: seven bars (money per day) with the number of trips under each. */
export function WeekChart({ days }: { days: WeekDay[] }) {
  const max = Math.max(1, ...days.map((d) => d.cents));
  const trips = days.reduce((s, d) => s + d.trips, 0), cents = days.reduce((s, d) => s + d.cents, 0);
  const label = (day: string) => new Intl.DateTimeFormat(intlLocale(), { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
  return (
    <div data-testid="week-chart">
      <p className="mb-3 text-sm text-mist-300">{t('{0} курса · {1} за последните 7 дни', trips, money(cents))}</p>
      <div className="flex h-32 items-end gap-2">
        {days.map((d) => (
          <div key={d.day} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${d.day}: ${money(d.cents)}`}>
            <span className="num text-[10px] text-mist-400">{d.trips || ''}</span>
            <div className="w-full rounded-t bg-volt-400/80" style={{ height: `${Math.max(d.cents ? 4 : 1, (d.cents / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-2">{days.map((d) => <span key={d.day} className="flex-1 text-center text-[10px] uppercase text-mist-400">{label(d.day)}</span>)}</div>
    </div>
  );
}
