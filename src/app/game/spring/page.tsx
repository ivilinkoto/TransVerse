import { Flower2, Mountain, Sprout, PartyPopper } from 'lucide-react';
import { notFound } from 'next/navigation';
import { Badge, Card, Meter, PageHeader } from '@/components/ui';
import { money } from '@/lib/format';
import { isEquinox, NATIONAL_DAY, PASS_OPENING, SOWING, SPRING, upcomingNationalDays } from '@/lib/game/spring';
import { gameContext } from '@/server/game/context';
import { equinoxTrips, passChronicle } from '@/server/game/spring';

export const metadata = { title: 'Първа пролет' };

const day = (md: string) => {
  const [m, d] = md.split('-').map(Number) as [number, number];
  return `${d} ${['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'][m - 1]}`;
};

/** Първа пролет (v1.6): the equinox, the passes that open, sowing and the national days. Game data. */
export default async function SpringPage() {
  const { db, user, now, features } = await gameContext();
  if (!features.spring) notFound();
  const [trips, passes] = await Promise.all([equinoxTrips(db, user.id), features.pass_opening ? passChronicle(db, SPRING.year) : []]);
  const live = isEquinox(now);
  return (
    <div className="space-y-6">
      <PageHeader title="Първа пролет" subtitle="Равноденствие, отворени проходи, сеитба и празниците на съседите. Игрови данни." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={<span className="inline-flex items-center gap-2"><Flower2 className="h-4 w-4 text-pink-300" />Равноденствие · {day(SPRING.equinox.from)} – {day(SPRING.equinox.to)}</span>}>
          <p className="text-sm text-mist-300">Денят и нощта са равни — всеки курс навреме носи +{Math.round(SPRING.equinoxShare * 100)} %, денем и нощем. {SPRING.equinoxBadgeTrips} курса навреме дават значка „Първа пролет {SPRING.year}“.</p>
          <div className="mt-3 flex justify-between text-sm"><span>Твоите курсове</span><span className="num">{Math.min(trips, SPRING.equinoxBadgeTrips)} / {SPRING.equinoxBadgeTrips}</span></div>
          <Meter value={(Math.min(trips, SPRING.equinoxBadgeTrips) / SPRING.equinoxBadgeTrips) * 100} tone="violet" className="mt-1" />
          {live ? <Badge tone="green">тече сега</Badge> : null}
          <p className="mt-3 text-xs text-mist-400">В магазина: боя „Цъфнала череша“ до {day(SPRING.to)}.</p>
        </Card>
        <Card title={<span className="inline-flex items-center gap-2"><Sprout className="h-4 w-4 text-profit" />Сеитба · {day(SOWING.from)} – {day(SOWING.to)}</span>}>
          <p className="text-sm text-mist-300">Семена, торове и препарати на палети и насипно, а трактори, сеялки и пръскачки — на нискорамно ремарке. Плащат +{Math.round((SOWING.rewardMultiplier - 1) * 100)} %; търси значката „🌱 Сеитба“ на борсата.</p>
        </Card>
        {features.pass_opening && (
          <Card title={<span className="inline-flex items-center gap-2"><Mountain className="h-4 w-4 text-cyan-glow" />Проходите се отварят · {day(PASS_OPENING.from)} – {day(PASS_OPENING.to)}</span>} className="lg:col-span-2">
            <p className="text-sm text-mist-300">След зимата първите {PASS_OPENING.firstN} шофьори, които минат с товар навреме през всяка планинска държава, получават {money(PASS_OPENING.prizeCents)} и влизат в хрониката на проходите.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {passes.map((p) => (
                <div key={p.country} className="rounded-xl border border-asphalt-700 p-3 text-sm">
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-xs text-mist-400">{p.first.length} / {PASS_OPENING.firstN}</div>
                  <ol className="mt-1 space-y-0.5 text-xs">{p.first.map((f) => <li key={f.rank}><span className="num text-mist-400">{f.rank}.</span> {f.username}</li>)}</ol>
                </div>
              ))}
            </div>
          </Card>
        )}
        {features.national_days && (
          <Card title={<span className="inline-flex items-center gap-2"><PartyPopper className="h-4 w-4 text-gold-400" />Празниците на съседите</span>} className="lg:col-span-2">
            <p className="text-sm text-mist-300">На националния празник на всяка държава в играта товарите до нея плащат +{Math.round((NATIONAL_DAY.rewardMultiplier - 1) * 100)} % (значка „🎉 Национален празник“ на борсата).</p>
            <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              {upcomingNationalDays(now, 6).map((d) => <li key={d.country} className="flex justify-between gap-2 rounded-lg bg-asphalt-850 px-3 py-2"><span>{d.label}</span><span className="text-mist-400">{day(d.day)}</span></li>)}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
