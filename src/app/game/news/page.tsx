import { CalendarDays, Crown, Fuel, Medal, Newspaper, Route, TrendingDown, TrendingUp, Users } from 'lucide-react';
import Link from 'next/link';
import { PlayerName } from '@/components/game/PlayerName';
import { Card, Empty, PageHeader } from '@/components/ui';
import { int, km, money } from '@/lib/format';
import { headline, lead } from '@/lib/game/news';
import { gameContext } from '@/server/game/context';
import { latestIssues } from '@/server/game/news';
import { t, tx, intlLocale } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Седмичник') };
}

const d = (iso: string, withTime = false) => new Date(iso).toLocaleString(intlLocale(), { timeZone: 'Europe/Sofia', day: 'numeric', month: 'long', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) });

export default async function NewsPage({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  await initLocale();
  const { db } = await gameContext();
  const issues = await latestIssues(db, 20);
  const wanted = Number((await searchParams).n);
  const issue = issues.find((i) => i.number === wanted) ?? issues[0];

  return (
    <div className="space-y-6">
      <PageHeader title={t('Седмичник TransVerse')} subtitle={t('Всеки понеделник: кой кара най-много, рекордите, горивото и какво предстои.')} help={t('Вестникът се пише автоматично от данните на играта за изминалата седмица (понеделник – неделя, българско време). Всички числа са игрови.')} />
      {!issue ? (
        <Card><Empty icon={Newspaper} title={t('Първият брой излиза в понеделник')}>{t('Тук ще прочетеш как мина седмицата по пътищата на TransVerse.')}</Empty></Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_16rem]">
          <article className="panel overflow-hidden">
            <header className="border-b border-asphalt-700 px-5 py-4 sm:px-7">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs uppercase tracking-[0.18em] text-mist-400">
                <span>{t('Брой {0}', issue.number)}</span>
                <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{d(issue.content.week.from)} – {d(new Date(new Date(issue.content.week.to).getTime() - 1).toISOString())}</span>
              </div>
              <h2 className="mt-3 font-display text-2xl font-bold leading-tight sm:text-3xl">{headline(issue.content)}</h2>
              <p className="mt-2 text-mist-300">{lead(issue.content)}</p>
            </header>
            <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-2">
              <section>
                <h3 className="label mb-2 flex items-center gap-1.5"><Crown className="h-3.5 w-3.5 text-gold-400" />{t('Най-доходни шофьори')}</h3>
                {issue.content.topEarners.length ? (
                  <ol className="space-y-1.5 text-sm">
                    {issue.content.topEarners.map((p, i) => (
                      <li key={p.username} className="flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-2"><span className="num w-5 text-mist-400">{i + 1}.</span><PlayerName name={p.username} /></span><span className="num text-profit">{money(p.value)}</span></li>
                    ))}
                  </ol>
                ) : <p className="text-sm text-mist-400">{t('Няма доставки.')}</p>}
              </section>
              <section>
                <h3 className="label mb-2 flex items-center gap-1.5"><Medal className="h-3.5 w-3.5 text-cyan-glow" />{t('Най-много курсове')}</h3>
                {issue.content.topDrivers.length ? (
                  <ol className="space-y-1.5 text-sm">
                    {issue.content.topDrivers.map((p, i) => (
                      <li key={p.username} className="flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-2"><span className="num w-5 text-mist-400">{i + 1}.</span><PlayerName name={p.username} /></span><span className="num">{int(p.value)}</span></li>
                    ))}
                  </ol>
                ) : <p className="text-sm text-mist-400">{t('Няма доставки.')}</p>}
              </section>
              <section>
                <h3 className="label mb-2 flex items-center gap-1.5"><Route className="h-3.5 w-3.5 text-prestige" />{t('Рекордите на седмицата')}</h3>
                <ul className="space-y-2 text-sm">
                  {issue.content.longest && <li><span className="text-mist-400">{t('Най-дълъг курс:')}{' '}</span><PlayerName name={issue.content.longest.username} /> — {tx(issue.content.longest.goods)}, {tx(issue.content.longest.from)} → {tx(issue.content.longest.to)}, <span className="num">{km(issue.content.longest.km)}</span></li>}
                  {issue.content.richest && <li><span className="text-mist-400">{t('Най-скъп товар:')}{' '}</span><PlayerName name={issue.content.richest.username} /> — {tx(issue.content.richest.goods)}, {tx(issue.content.richest.from)} → {tx(issue.content.richest.to)}, <span className="num text-profit">{money(issue.content.richest.rewardCents)}</span></li>}
                  {!issue.content.longest && <li className="text-mist-400">{t('Няма рекорди тази седмица.')}</li>}
                </ul>
              </section>
              <section>
                <h3 className="label mb-2 flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-gold-400" />{t('Компаниите')}</h3>
                {issue.content.topCompanies.length ? (
                  <ol className="space-y-1.5 text-sm">
                    {issue.content.topCompanies.map((c, i) => (
                      <li key={c.name} className="flex justify-between gap-2"><span className="min-w-0 truncate"><span className="num mr-2 text-mist-400">{i + 1}.</span>{c.tag ? `[${c.tag}] ` : ''}{tx(c.name)}</span><span className="num shrink-0">{t('{0} доставки', int(c.deliveries))}</span></li>
                    ))}
                  </ol>
                ) : <p className="text-sm text-mist-400">{t('Компаниите почиваха.')}</p>}
              </section>
              <section>
                <h3 className="label mb-2 flex items-center gap-1.5"><Fuel className="h-3.5 w-3.5 text-mist-400" />{t('Пазарът')}</h3>
                <ul className="space-y-1.5 text-sm">
                  {issue.content.fuel && <li>{t('Най-евтин дизел:')}{' '}<b>{tx(issue.content.fuel.cheapest.country)}</b>{' '}{t('({0} лв./л); най-скъп:', (issue.content.fuel.cheapest.cents / 100).toFixed(2))}{' '}<b>{tx(issue.content.fuel.dearest.country)}</b>{' '}{t('({0} лв./л).', (issue.content.fuel.dearest.cents / 100).toFixed(2))}</li>}
                  {issue.content.demand.hot && <li className="flex items-center gap-1.5"><TrendingUp className="h-4 w-4 text-profit" />{t('Най-търсени: {0}', issue.content.demand.hot.cargo)}</li>}
                  {issue.content.demand.cold && <li className="flex items-center gap-1.5"><TrendingDown className="h-4 w-4 text-loss" />{t('Най-малко търсени: {0}', issue.content.demand.cold.cargo)}</li>}
                  {issue.content.marketEvents.map((e) => <li key={e.title}>{tx(e.title)} <span className="text-mist-400">{t('(до {0})', d(e.endsAt))}</span></li>)}
                </ul>
              </section>
              <section>
                <h3 className="label mb-2 flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 text-cyan-glow" />{t('Предстои')}</h3>
                {issue.content.upcoming.length ? (
                  <ul className="space-y-1.5 text-sm">
                    {issue.content.upcoming.map((e) => <li key={e.name}><Link href="/game/events" className="font-medium hover:underline">{tx(e.name)}</Link> <span className="text-mist-400">· {d(e.startsAt, true)} – {d(e.endsAt, true)}</span></li>)}
                  </ul>
                ) : <p className="text-sm text-mist-400">{t('Следете ивентите — нови се обявяват всяка седмица.')}</p>}
              </section>
            </div>
            <footer className="border-t border-asphalt-700 px-5 py-3 text-xs text-mist-500 sm:px-7">{t('Игрови данни. Написан автоматично от редакцията на TransVerse.')}</footer>
          </article>
          <aside>
            <Card title={t('Броеве')}>
              <ul className="space-y-1 text-sm">
                {issues.map((i) => (
                  <li key={i.number}><Link href={`/game/news?n=${i.number}`} className={`block rounded-lg px-2 py-1.5 ${i.number === issue.number ? 'bg-asphalt-800 text-white' : 'text-mist-300 hover:text-white'}`}>№ {tx(i.number)} · {d(i.content.week.from)}</Link></li>
                ))}
              </ul>
            </Card>
          </aside>
        </div>
      )}
    </div>
  );
}
