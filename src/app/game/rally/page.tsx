import Link from 'next/link';
import { Flag } from 'lucide-react';
import { notFound } from 'next/navigation';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { dateTime, int, money } from '@/lib/format';
import { RALLY, RALLY_CATEGORIES, type RallyCategory } from '@/lib/game/rally';
import { gameContext } from '@/server/game/context';
import { activeRally, myRallyEntry, rallyResults } from '@/server/game/rally';

export const metadata = { title: 'Рали' };

const hm = (min: number) => `${Math.floor(min / 60)} ч ${String(min % 60).padStart(2, '0')} мин`;

export default async function RallyPage() {
  const { db, user, features } = await gameContext();
  if (!features.rally) notFound();
  const rally = await activeRally(db);
  const [results, mine] = rally ? await Promise.all([rallyResults(db, rally.id), myRallyEntry(db, rally.id, user.id)]) : [null, null];
  const prizes = RALLY.prizes.map((p, i) => `${i + 1}. ${money(p.cents)} + ${p.coins} TC`).join(' · ');
  return (
    <div className="space-y-6">
      <PageHeader
        title="Седмично рали"
        subtitle="Един и същ истински маршрут за всички — кой ще стигне най-бързо и кой най-икономично?"
        help={`Всяка седмица нов маршрут между два големи града. Записваш се веднъж — на борсата в началния град се появява твоят рали товар (${RALLY.tons} т). Мери се времето от товаренето до разтоварването и разходът за гориво (или ток) на 100 км. Празният курс до старта не се брои. След края на седмицата първите трима във всяка категория получават награди: ${prizes}. Наградите и товарът са игрови данни.`}
      />
      {!rally ? (
        <Card><Empty icon={Flag} title="Ралито се подготвя">Маршрутът на седмицата се обявява до половин час след началото ѝ.</Empty></Card>
      ) : (
        <>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 font-display text-xl font-bold"><Flag className="h-5 w-5 text-orange-400" />{rally.from} → {rally.to}</div>
                <div className="mt-1 text-sm text-mist-300"><span className="num">{int(rally.distanceKm)} км</span> · край {dateTime(rally.endsAt)} · записани {results!.entries}</div>
              </div>
              {!mine ? (
                <ActionButton className="btn-primary" action={{ type: 'joinRally' }}>Запиши се</ActionButton>
              ) : mine.finishedAt ? (
                <Badge tone="green">Финишира: {hm(mine.minutes ?? 0)} · {money(mine.fuelCentsPer100 ?? 0)}/100 км</Badge>
              ) : (
                <Link href={`/game/contracts?from=${rally.originCityId}`} className="btn-primary">Към товара в {rally.from}</Link>
              )}
            </div>
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            {(['fastest', 'eco'] as RallyCategory[]).map((cat) => (
              <Card key={cat} title={RALLY_CATEGORIES[cat]}>
                {results![cat].length === 0 ? (
                  <p className="text-sm text-mist-400">Още никой не е финиширал.</p>
                ) : (
                  <ol className="space-y-1.5 text-sm">
                    {results![cat].slice(0, 10).map((r, i) => (
                      <li key={r.userId} className={`flex justify-between gap-2 ${r.userId === user.id ? 'text-gold-400' : ''}`}>
                        <span>{i < 3 ? ['🥇', '🥈', '🥉'][i] : `${i + 1}.`} {r.username}</span>
                        <span className="num">{cat === 'fastest' ? hm(r.minutes) : `${money(r.fuelCentsPer100)}/100 км`}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
