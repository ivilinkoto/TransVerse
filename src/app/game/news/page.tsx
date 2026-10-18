import { CalendarDays, Crown, Fuel, Medal, Newspaper, Route, TrendingDown, TrendingUp, Users } from 'lucide-react';
import Link from 'next/link';
import { PlayerName } from '@/components/game/PlayerName';
import { Card, Empty, PageHeader } from '@/components/ui';
import { int, km, money } from '@/lib/format';
import { headline, lead } from '@/lib/game/news';
import { gameContext } from '@/server/game/context';
import { latestIssues } from '@/server/game/news';

export const metadata = { title: 'Седмичник' };

const d = (iso: string, withTime = false) => new Date(iso).toLocaleString('bg-BG', { timeZone: 'Europe/Sofia', day: 'numeric', month: 'long', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) });

export default async function NewsPage({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const { db } = await gameContext();
  const issues = await latestIssues(db, 20);
  const wanted = Number((await searchParams).n);
  const issue = issues.find((i) => i.number === wanted) ?? issues[0];

  return (
    <div className="space-y-6">
      <PageHeader title="Седмичник TransVerse" subtitle="Всеки понеделник: кой кара най-много, рекордите, горивото и какво предстои." help="Вестникът се пише автоматично от данните на играта за изминалата седмица (понеделник – неделя, българско време). Всички числа са игрови." />
      {!issue ? (
        <Card><Empty icon={Newspaper} title="Първият брой излиза в понеделник">Тук ще прочетеш как мина седмицата по пътищата на TransVerse.</Empty></Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_16rem]">
          <article className="panel overflow-hidden">
            <header className="border-b border-asphalt-700 px-5 py-4 sm:px-7">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs uppercase tracking-[0.18em] text-mist-400">
                <span>Брой {issue.number}</span>
                <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{d(issue.content.week.from)} – {d(new Date(new Date(issue.content.week.to).getTime() - 1).toISOString())}</span>
              </div>
              <h2 className="mt-3 font-display text-2xl font-bold leading-tight sm:text-3xl">{headline(issue.content)}</h2>
              <p className="mt-2 text-mist-300">{lead(issue.content)}</p>
            </header>
            <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-2">
              <section>
                <h3 className="label mb-2 flex items-center gap-1.5"><Crown className="h-3.5 w-3.5 text-gold-400" />Най-доходни шофьори</h3>
                {issue.content.topEarners.length ? (
                  <ol className="space-y-1.5 text-sm">
                    {issue.content.topEarners.map((p, i) => (
                      <li key={p.username} className="flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-2"><span className="num w-5 text-mist-400">{i + 1}.</span><PlayerName name={p.username} /></span><span className="num text-profit">{money(p.value)}</span></li>
                    ))}
                  </ol>
                ) : <p className="text-sm text-mist-400">Няма доставки.</p>}
              </section>
              <section>
                <h3 className="label mb-2 flex items-center gap-1.5"><Medal className="h-3.5 w-3.5 text-cyan-glow" />Най-много курсове</h3>
                {issue.content.topDrivers.length ? (
                  <ol className="space-y-1.5 text-sm">
                    {issue.content.topDrivers.map((p, i) => (
                      <li key={p.username} className="flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-2"><span className="num w-5 text-mist-400">{i + 1}.</span><PlayerName name={p.username} /></span><span className="num">{int(p.value)}</span></li>
                    ))}
                  </ol>
                ) : <p className="text-sm text-mist-400">Няма доставки.</p>}
              </section>
              <section>
                <h3 className="label mb-2 flex items-center gap-1.5"><Route className="h-3.5 w-3.5 text-prestige" />Рекордите на седмицата</h3>
                <ul className="space-y-2 text-sm">
                  {issue.content.longest && <li><span className="text-mist-400">Най-дълъг курс: </span><PlayerName name={issue.content.longest.username} /> — {issue.content.longest.goods}, {issue.content.longest.from} → {issue.content.longest.to}, <span className="num">{km(issue.content.longest.km)}</span></li>}
                  {issue.content.richest && <li><span className="text-mist-400">Най-скъп товар: </span><PlayerName name={issue.content.richest.username} /> — {issue.content.richest.goods}, {issue.content.richest.from} → {issue.content.richest.to}, <span className="num text-profit">{money(issue.content.richest.rewardCents)}</span></li>}
                  {!issue.content.longest && <li className="text-mist-400">Няма рекорди тази седмица.</li>}
                </ul>
              </section>
              <section>
                <h3 className="label mb-2 flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-gold-400" />Компаниите</h3>
                {issue.content.topCompanies.length ? (
                  <ol className="space-y-1.5 text-sm">
                    {issue.content.topCompanies.map((c, i) => (
                      <li key={c.name} className="flex justify-between gap-2"><span className="min-w-0 truncate"><span className="num mr-2 text-mist-400">{i + 1}.</span>{c.tag ? `[${c.tag}] ` : ''}{c.name}</span><span className="num shrink-0">{int(c.deliveries)} доставки</span></li>
                    ))}
                  </ol>
                ) : <p className="text-sm text-mist-400">Компаниите почиваха.</p>}
              </section>
              <section>
                <h3 className="label mb-2 flex items-center gap-1.5"><Fuel className="h-3.5 w-3.5 text-mist-400" />Пазарът</h3>
                <ul className="space-y-1.5 text-sm">
                  {issue.content.fuel && <li>Най-евтин дизел: <b>{issue.content.fuel.cheapest.country}</b> ({(issue.content.fuel.cheapest.cents / 100).toFixed(2)} лв./л); най-скъп: <b>{issue.content.fuel.dearest.country}</b> ({(issue.content.fuel.dearest.cents / 100).toFixed(2)} лв./л).</li>}
                  {issue.content.demand.hot && <li className="flex items-center gap-1.5"><TrendingUp className="h-4 w-4 text-profit" />Най-търсени: {issue.content.demand.hot.cargo}</li>}
                  {issue.content.demand.cold && <li className="flex items-center gap-1.5"><TrendingDown className="h-4 w-4 text-loss" />Най-малко търсени: {issue.content.demand.cold.cargo}</li>}
                  {issue.content.marketEvents.map((e) => <li key={e.title}>{e.title} <span className="text-mist-400">(до {d(e.endsAt)})</span></li>)}
                </ul>
              </section>
              <section>
                <h3 className="label mb-2 flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 text-cyan-glow" />Предстои</h3>
                {issue.content.upcoming.length ? (
                  <ul className="space-y-1.5 text-sm">
                    {issue.content.upcoming.map((e) => <li key={e.name}><Link href="/game/events" className="font-medium hover:underline">{e.name}</Link> <span className="text-mist-400">· {d(e.startsAt, true)} – {d(e.endsAt, true)}</span></li>)}
                  </ul>
                ) : <p className="text-sm text-mist-400">Следете ивентите — нови се обявяват всяка седмица.</p>}
              </section>
            </div>
            <footer className="border-t border-asphalt-700 px-5 py-3 text-xs text-mist-500 sm:px-7">Игрови данни. Написан автоматично от редакцията на TransVerse.</footer>
          </article>
          <aside>
            <Card title="Броеве">
              <ul className="space-y-1 text-sm">
                {issues.map((i) => (
                  <li key={i.number}><Link href={`/game/news?n=${i.number}`} className={`block rounded-lg px-2 py-1.5 ${i.number === issue.number ? 'bg-asphalt-800 text-white' : 'text-mist-300 hover:text-white'}`}>№ {i.number} · {d(i.content.week.from)}</Link></li>
                ))}
              </ul>
            </Card>
          </aside>
        </div>
      )}
    </div>
  );
}
