import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { and, eq, isNull } from 'drizzle-orm';
import { PageHeader } from '@/components/ui';
import { NightRunGame } from '@/components/game/NightRunGame';
import { NIGHT_RUN } from '@/lib/game/night-run';
import { int } from '@/lib/format';
import { companies, users, vehicles } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';
import { nightRunRanking, nightRunView } from '@/server/game/night-run';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Нощен рейс') };
}

/** 1.3 „Нощен рейс“: the day's arcade run, three tries, today's longest runs. */
export default async function NightRunPage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.night_run) notFound();
  const view = await nightRunView(db, user.id, now);
  const ranking = await nightRunRanking(db, now);
  // The truck in the player's colours: the favourite one, else any own truck.
  const [fav] = await db.select({ colour: vehicles.color }).from(vehicles).innerJoin(companies, eq(companies.id, vehicles.companyId)).innerJoin(users, eq(users.id, companies.ownerId)).where(and(eq(users.id, user.id), isNull(vehicles.soldAt))).limit(1);
  return (
    <div className="space-y-4">
      <PageHeader title={t('Нощен рейс')} subtitle={t('Един и същ нощен път за всички, нов всеки ден.')} help={t('{0} рейса на ден, брои се най-дългият. Звезди: {1}, {2} и {3} м — опит за най-добрия рейс.', NIGHT_RUN.runsPerDay, NIGHT_RUN.stars[0], NIGHT_RUN.stars[1], NIGHT_RUN.stars[2])} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
        <section className="night-run-card rounded-3xl p-3 sm:p-4">
          <NightRunGame day={view.day} colour={fav?.colour ?? '#22d3ee'} runsLeft={view.runsLeft} />
        </section>
        <aside className="space-y-3">
          <section className="panel p-4">
            <h2 className="font-display font-bold text-white">{t('Днес')}</h2>
            <p className="text-sm text-mist-300">{view.runs.length ? t('Най-добър: {0} м · {1} от {2} рейса', int(view.best), view.runs.length, NIGHT_RUN.runsPerDay) : t('Още не си карал днес.')}</p>
          </section>
          <section className="panel p-4" data-testid="night-run-ranking">
            <h2 className="mb-2 font-display font-bold text-white">🏁 {t('Най-дългите рейсове днес')}</h2>
            {ranking.length === 0 ? <p className="text-sm text-mist-400">{t('Още никой не е карал тази нощ.')}</p> : (
              <ol className="space-y-1 text-sm">
                {ranking.map((r, i) => (
                  <li key={r.userId} className={`flex justify-between gap-2 rounded-lg px-2 py-1 ${r.userId === user.id ? 'bg-cyan-glow/10' : ''}`}>
                    <span className="min-w-0 truncate"><span className="num mr-2 text-mist-400">{int(i + 1)}.</span>{tx(r.username)}</span>
                    <span className="num shrink-0 font-semibold text-white">{int(r.metres)} м {'★'.repeat(r.stars)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
