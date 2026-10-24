import Link from 'next/link';
import { Globe2, Trophy, Truck } from 'lucide-react';
import { notFound } from 'next/navigation';
import { Badge, Card, Empty, Meter, PageHeader } from '@/components/ui';
import { dateTime, int } from '@/lib/format';
import { BIG_CONVOY, EUROTOUR, GRAND_EUROTOUR, WEEKLY_CHALLENGE } from '@/lib/game/challenges';
import { CONVOY_RULES } from '@/lib/game/convoy';
import { gameContext } from '@/server/game/context';
import { eurotourProgress, grandEurotourProgress, lastChallengeWinners, openBigConvoys, weeklyChallenge } from '@/server/game/challenges';

export const metadata = { title: 'Предизвикателства' };

/** v1.6: the challenge of the week, Евротур and the big convoy. Game data. */
export default async function ChallengesPage() {
  const { db, user, now, features } = await gameContext();
  if (!features.weekly_challenge) notFound();
  const [week, tour, grand, convoys, last] = await Promise.all([
    weeklyChallenge(db, now, user.id),
    features.eurotour ? eurotourProgress(db, user.id, now) : null,
    features.grand_eurotour ? grandEurotourProgress(db, user.id, now) : null,
    features.big_convoy ? openBigConvoys(db, now) : [],
    lastChallengeWinners(db, now),
  ]);
  const prizes = WEEKLY_CHALLENGE.prizes.map((c, i) => `${i + 1}. ${c} TC`).join(' · ');
  const visited = tour?.filter((c) => c.done).length ?? 0;
  const grandVisited = grand?.countries.filter((c) => c.done).length ?? 0;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Предизвикателства"
        subtitle="Всяка седмица нова мярка, Евротур през месеца и големи конвои. Игрови данни."
        help={`Предизвикателството на седмицата сменя мярката всеки понеделник. Броят се всички курсове навреме, пристигнали през седмицата — не само един маршрут като ралито. След края на седмицата първите трима получават ${prizes}.`}
      />
      <Card title={<span className="inline-flex items-center gap-2"><Trophy className="h-4 w-4 text-amber-sig" />{week.title}</span>}>
        <p className="text-sm text-mist-300">{week.description} Курсовете навреме до {dateTime(week.endsAt)}. Награди: {prizes}.</p>
        {week.mine ? <p className="mt-2 text-sm">Ти си <span className="font-semibold">{week.mine.place}.</span> от {int(week.players)} · <span className="num">{int(week.mine.value)}</span> {week.unit}</p> : <p className="mt-2 text-sm text-mist-400">Още нямаш курс навреме тази седмица.</p>}
        {week.top.length ? (
          <ol className="mt-3 divide-y divide-white/5 text-sm">
            {week.top.map((r, i) => (
              <li key={r.userId} className={`flex justify-between py-1.5 ${r.userId === user.id ? 'text-cyan-glow' : ''}`}>
                <span><span className="num mr-2 text-mist-400">{i + 1}.</span>{r.username}{i < WEEKLY_CHALLENGE.prizes.length ? <span className="ml-2"><Badge tone="orange">{WEEKLY_CHALLENGE.prizes[i]} TC</Badge></span> : null}</span>
                <span className="num">{int(r.value)} {week.unit}</span>
              </li>
            ))}
          </ol>
        ) : (
          <Empty icon={Trophy} title="Класацията е празна">Първият курс навреме тази седмица я открива.</Empty>
        )}
      </Card>
      {last && (
        <Card title={`Миналата седмица: ${last.title}`}>
          <ol className="space-y-1 text-sm">
            {last.winners.map((w, i) => <li key={w.userId} className="flex justify-between"><span><span className="num mr-2 text-mist-400">{i + 1}.</span>{w.username ?? '—'}</span><span className="num">{int(w.value ?? 0)} {last.unit} · {WEEKLY_CHALLENGE.prizes[i]} TC</span></li>)}
          </ol>
        </Card>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        {tour && (
          <Card title={<span className="inline-flex items-center gap-2"><Globe2 className="h-4 w-4 text-cyan-glow" />Евротур · {visited} / {tour.length}</span>}>
            <p className="text-sm text-mist-300">Достави до всичките {tour.length} държави на играта в един календарен месец — значка „Евротур“ и {EUROTOUR.coins} TC (веднъж в месеца).</p>
            <Meter value={(visited / tour.length) * 100} tone="cyan" className="mt-3" />
            <div className="mt-3 flex flex-wrap gap-2">
              {tour.map((c) => <Badge key={c.code} tone={c.done ? 'green' : 'neutral'}>{c.done ? '✓ ' : ''}{c.name}</Badge>)}
            </div>
          </Card>
        )}
        {grand && (
          <Card title={<span className="inline-flex items-center gap-2"><Globe2 className="h-4 w-4 text-amber-sig" />Голям евротур · {grandVisited} / {grand.countries.length}</span>}>
            <p className="text-sm text-mist-300">Достави до всичките {grand.countries.length} държави на играта в един сезон ({grand.season.name}, до {dateTime(grand.season.endsAt)}) — значка „Голям евротур“ и {GRAND_EUROTOUR.coins} TC.</p>
            <Meter value={(grandVisited / grand.countries.length) * 100} tone="cyan" className="mt-3" />
            <div className="mt-3 flex flex-wrap gap-2">
              {grand.countries.map((c) => <Badge key={c.code} tone={c.done ? 'green' : 'neutral'}>{c.done ? '✓ ' : ''}{c.name}</Badge>)}
            </div>
          </Card>
        )}
        {features.convoy_lobby && (
          <Card title={<span className="inline-flex items-center gap-2"><Truck className="h-4 w-4 text-profit" />Конвои</span>}>
            <p className="text-sm text-mist-300">Конвоите вече се събират предварително: една линия, един час на тръгване, всички пристигат заедно. Всяка неделя в 20:00 тръгва и големият конвой на TransVerse.</p>
            <Link href="/game/convoys" className="btn-primary mt-3 inline-flex">Към конвоите</Link>
          </Card>
        )}
        {features.big_convoy && !features.convoy_lobby && (
          <Card title={<span className="inline-flex items-center gap-2"><Truck className="h-4 w-4 text-profit" />Голям конвой</span>}>
            <p className="text-sm text-mist-300">
              До {BIG_CONVOY.maxTrucks} камиона по една линия, тръгнали до {Math.round(CONVOY_RULES.windowMs / 60_000)} мин. един след друг. От {BIG_CONVOY.minTrucks} камиона нагоре всеки, който пристигне навреме, получава още
              {' '}{Object.entries(BIG_CONVOY.bonusShare).map(([n, s]) => `+${Math.round(s * 100)} % (${n})`).join(', ')} към наградата, а първият — значка „Водач на колона“.
            </p>
            <p className="mt-2 text-xs text-mist-400">Обявените конвои (/конвой в Discord), в които има място:</p>
            {convoys.length ? (
              <ul className="mt-1 divide-y divide-white/5 text-sm">
                {convoys.map((c) => (
                  <li key={c.id} className="flex justify-between py-1.5"><span>{c.from} → {c.to} · {c.username}</span><span className="num">{c.size} / {BIG_CONVOY.maxTrucks} · до {dateTime(c.expiresAt)}</span></li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-mist-400">Сега няма отворен конвой.</p>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
