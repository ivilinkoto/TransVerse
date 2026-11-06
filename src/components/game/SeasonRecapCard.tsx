import { Medal, Route, Ticket, Trophy, Truck } from 'lucide-react';
import { date, int } from '@/lib/format';
import type { seasonRecap } from '@/server/game/final-sprint';
import { t, tx } from '@/i18n/t';

type Recap = NonNullable<Awaited<ReturnType<typeof seasonRecap>>>;

/** 1.2.3.1: one player's season on one card (the private page and the shared one). */
export function SeasonRecapCard({ recap, username }: { recap: Recap; username: string }) {
  const stats = [
    { icon: Trophy, label: t('Място'), value: recap.place ? `#${recap.place}` : '—', hint: t('от {0} играчи', recap.players) },
    { icon: Medal, label: t('Точки'), value: int(recap.points), hint: '' },
    { icon: Truck, label: t('Доставки'), value: int(recap.deliveries), hint: '' },
    { icon: Route, label: t('Километри с товар'), value: int(recap.km), hint: t('най-дълъг курс: {0} км', int(recap.longestKm)) },
    { icon: Ticket, label: t('Пропуск'), value: t('ниво {0}', recap.passLevel), hint: '' },
  ];
  return (
    <section className="panel relative overflow-hidden p-5 sm:p-6" data-testid="season-recap">
      <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-gold-400/15 blur-3xl" aria-hidden="true" />
      <div className="relative">
        <div className="label text-gold-400">{tx(recap.season.name)} · {date(recap.season.startsAt)} – {date(recap.season.endsAt)}</div>
        <h2 className="mt-1 font-display text-2xl font-bold">{t('Сезонът на {0}', username)}</h2>
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {stats.map((s) => (
            <li key={s.label} className="rounded-2xl border border-asphalt-700 bg-asphalt-850 p-3">
              <div className="flex items-center gap-1.5 text-xs text-mist-400"><s.icon className="h-3.5 w-3.5 text-gold-400" />{s.label}</div>
              <div className="num mt-1 font-display text-xl font-bold">{s.value}</div>
              {s.hint && <div className="text-[11px] text-mist-400">{s.hint}</div>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
