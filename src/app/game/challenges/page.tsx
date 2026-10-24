import Link from 'next/link';
import { Globe2, Trophy, Truck } from 'lucide-react';
import { notFound } from 'next/navigation';
import { Badge, Card, Empty, Meter, PageHeader } from '@/components/ui';
import { dateTime, int } from '@/lib/format';
import { BIG_CONVOY, EUROTOUR, GRAND_EUROTOUR, WEEKLY_CHALLENGE } from '@/lib/game/challenges';
import { CONVOY_RULES } from '@/lib/game/convoy';
import { gameContext } from '@/server/game/context';
import { eurotourProgress, grandEurotourProgress, lastChallengeWinners, openBigConvoys, weeklyChallenge } from '@/server/game/challenges';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Предизвикателства') };
}

/** v1.6: the challenge of the week, Евротур and the big convoy. Game data. */
export default async function ChallengesPage() {
  await initLocale();
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
        title={t('Предизвикателства')}
        subtitle={t('Всяка седмица нова мярка, Евротур през месеца и големи конвои. Игрови данни.')}
        help={t('Предизвикателството на седмицата сменя мярката всеки понеделник. Броят се всички курсове навреме, пристигнали през седмицата — не само един маршрут като ралито. След края на седмицата първите трима получават {0}.', prizes)}
      />
      <Card title={<span className="inline-flex items-center gap-2"><Trophy className="h-4 w-4 text-amber-sig" />{tx(week.title)}</span>}>
        <p className="text-sm text-mist-300">{t('{0} Курсовете навреме до {1}. Награди: {2}.', week.description, dateTime(week.endsAt), prizes)}</p>
        {week.mine ? <p className="mt-2 text-sm">{t('Ти си')}{' '}<span className="font-semibold">{tx(week.mine.place)}.</span>{' '}{t('от {0} ·', int(week.players))}{' '}<span className="num">{int(week.mine.value)}</span> {tx(week.unit)}</p> : <p className="mt-2 text-sm text-mist-400">{t('Още нямаш курс навреме тази седмица.')}</p>}
        {week.top.length ? (
          <ol className="mt-3 divide-y divide-white/5 text-sm">
            {week.top.map((r, i) => (
              <li key={r.userId} className={`flex justify-between py-1.5 ${r.userId === user.id ? 'text-cyan-glow' : ''}`}>
                <span><span className="num mr-2 text-mist-400">{i + 1}.</span>{tx(r.username)}{i < WEEKLY_CHALLENGE.prizes.length ? <span className="ml-2"><Badge tone="orange">{tx(WEEKLY_CHALLENGE.prizes[i])} TC</Badge></span> : null}</span>
                <span className="num">{int(r.value)} {tx(week.unit)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <Empty icon={Trophy} title={t('Класацията е празна')}>{t('Първият курс навреме тази седмица я открива.')}</Empty>
        )}
      </Card>
      {last && (
        <Card title={t('Миналата седмица: {0}', last.title)}>
          <ol className="space-y-1 text-sm">
            {last.winners.map((w, i) => <li key={w.userId} className="flex justify-between"><span><span className="num mr-2 text-mist-400">{i + 1}.</span>{w.username ?? '—'}</span><span className="num">{int(w.value ?? 0)} {tx(last.unit)} · {tx(WEEKLY_CHALLENGE.prizes[i])} TC</span></li>)}
          </ol>
        </Card>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        {tour && (
          <Card title={<span className="inline-flex items-center gap-2"><Globe2 className="h-4 w-4 text-cyan-glow" />{t('Евротур · {0} / {1}', visited, tour.length)}</span>}>
            <p className="text-sm text-mist-300">{t('Достави до всичките {0} държави на играта в един календарен месец — значка „Евротур“ и {1} TC (веднъж в месеца).', tour.length, EUROTOUR.coins)}</p>
            <Meter value={(visited / tour.length) * 100} tone="cyan" className="mt-3" />
            <div className="mt-3 flex flex-wrap gap-2">
              {tour.map((c) => <Badge key={c.code} tone={c.done ? 'green' : 'neutral'}>{c.done ? '✓ ' : ''}{tx(c.name)}</Badge>)}
            </div>
          </Card>
        )}
        {grand && (
          <Card title={<span className="inline-flex items-center gap-2"><Globe2 className="h-4 w-4 text-amber-sig" />{t('Голям евротур · {0} / {1}', grandVisited, grand.countries.length)}</span>}>
            <p className="text-sm text-mist-300">{t('Достави до всичките {0} държави на играта в един сезон ({1}, до {2}) — значка „Голям евротур“ и {3} TC.', grand.countries.length, grand.season.name, dateTime(grand.season.endsAt), GRAND_EUROTOUR.coins)}</p>
            <Meter value={(grandVisited / grand.countries.length) * 100} tone="cyan" className="mt-3" />
            <div className="mt-3 flex flex-wrap gap-2">
              {grand.countries.map((c) => <Badge key={c.code} tone={c.done ? 'green' : 'neutral'}>{c.done ? '✓ ' : ''}{tx(c.name)}</Badge>)}
            </div>
          </Card>
        )}
        {features.convoy_lobby && (
          <Card title={<span className="inline-flex items-center gap-2"><Truck className="h-4 w-4 text-profit" />{t('Конвои')}</span>}>
            <p className="text-sm text-mist-300">{t('Конвоите вече се събират предварително: една линия, един час на тръгване, всички пристигат заедно. Всяка неделя в 20:00 тръгва и големият конвой на TransVerse.')}</p>
            <Link href="/game/convoys" className="btn-primary mt-3 inline-flex">{t('Към конвоите')}</Link>
          </Card>
        )}
        {features.big_convoy && !features.convoy_lobby && (
          <Card title={<span className="inline-flex items-center gap-2"><Truck className="h-4 w-4 text-profit" />{t('Голям конвой')}</span>}>
            <p className="text-sm text-mist-300">
              {t('До {0} камиона по една линия, тръгнали до {1} мин. един след друг. От {2} камиона нагоре всеки, който пристигне навреме, получава още{3}', BIG_CONVOY.maxTrucks, Math.round(CONVOY_RULES.windowMs / 60_000), BIG_CONVOY.minTrucks, ' ')}{Object.entries(BIG_CONVOY.bonusShare).map(([n, s]) => `+${Math.round(s * 100)} % (${n})`).join(', ')}{' '}{t('към наградата, а първият — значка „Водач на колона“.')}
            </p>
            <p className="mt-2 text-xs text-mist-400">{t('Обявените конвои (/конвой в Discord), в които има място:')}</p>
            {convoys.length ? (
              <ul className="mt-1 divide-y divide-white/5 text-sm">
                {convoys.map((c) => (
                  <li key={c.id} className="flex justify-between py-1.5"><span>{tx(c.from)} → {tx(c.to)} · {tx(c.username)}</span><span className="num">{t('{0} / {1} · до {2}', c.size, BIG_CONVOY.maxTrucks, dateTime(c.expiresAt))}</span></li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-mist-400">{t('Сега няма отворен конвой.')}</p>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
