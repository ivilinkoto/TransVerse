import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui';
import { DailyRoutePuzzle } from '@/components/game/DailyRoutePuzzle';
import { DAILY_ROUTE } from '@/lib/game/daily-route';
import { int } from '@/lib/format';
import { gameContext } from '@/server/game/context';
import { dailyRouteRanking, dailyRouteView } from '@/server/game/daily-route';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Пътят на деня') };
}

/** 1.3 „Пътят на деня“: the daily route puzzle, its rules and today's best players. */
export default async function DailyRoutePage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.daily_route) notFound();
  const view = await dailyRouteView(db, user.id, now);
  const ranking = await dailyRouteRanking(db, now);
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('Пътят на деня')}
        subtitle={t('Подреди градовете в най-краткия път. Един пъзел за всички, нов всеки ден.')}
        help={t('Започваш от първия град и минаваш през всички останали по веднъж (без връщане). Разстоянията са по права линия между истинските градове. Имаш {0} опита; брои се най-добрият. От 90% — {1} лв., за най-краткия път — още {2} лв. (веднъж на ден).', DAILY_ROUTE.tries, DAILY_ROUTE.rewards.good.cents / 100, DAILY_ROUTE.rewards.perfect.cents / 100)}
      />
      <DailyRoutePuzzle view={{ ...view, cities: view.cities.map((c) => ({ ...c, name: tx(c.name) })) }} />
      <section className="panel p-4" data-testid="daily-route-ranking">
        <h2 className="mb-2 font-display text-lg font-bold text-white">🏁 {t('Днешните най-добри')}</h2>
        {ranking.length === 0 ? (
          <p className="text-sm text-mist-400">{t('Още никой не е решил днешния път. Бъди първият!')}</p>
        ) : (
          <ol className="space-y-1 text-sm">
            {ranking.map((r, i) => (
              <li key={r.userId} className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 ${r.userId === user.id ? 'bg-cyan-glow/10' : ''}`}>
                <span className="min-w-0 truncate"><span className="num mr-2 text-mist-400">{int(i + 1)}.</span>{tx(r.username)}</span>
                <span className="num shrink-0 font-semibold text-white">{r.pct}% · {r.tries}/{DAILY_ROUTE.tries}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
