import Link from 'next/link';
import { Flag } from 'lucide-react';
import { notFound } from 'next/navigation';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { dateTime, int, money } from '@/lib/format';
import { RALLY, RALLY_CATEGORIES, type RallyCategory } from '@/lib/game/rally';
import { gameContext } from '@/server/game/context';
import { activeRally, myRallyEntry, rallyResults } from '@/server/game/rally';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Рали') };
}

const hm = (min: number) => t('{0} ч {1} мин', Math.floor(min / 60), String(min % 60).padStart(2, '0'));

export default async function RallyPage() {
  await initLocale();
  const { db, user, features } = await gameContext();
  if (!features.rally) notFound();
  const rally = await activeRally(db);
  const [results, mine] = rally ? await Promise.all([rallyResults(db, rally.id), myRallyEntry(db, rally.id, user.id)]) : [null, null];
  const prizes = RALLY.prizes.map((p, i) => `${i + 1}. ${money(p.cents)} + ${p.coins} TC`).join(' · ');
  return (
    <div className="space-y-6">
      <PageHeader
        title={t('Седмично рали')}
        subtitle={t('Един и същ истински маршрут за всички — кой ще стигне най-бързо и кой най-икономично?')}
        help={t('Всяка седмица нов маршрут между два големи града. Записваш се веднъж — на борсата в началния град се появява твоят рали товар ({0} т). Мери се времето от товаренето до разтоварването и разходът за гориво (или ток) на 100 км. Празният курс до старта не се брои. След края на седмицата първите трима във всяка категория получават награди: {1}. Наградите и товарът са игрови данни.', RALLY.tons, prizes)}
      />
      {!rally ? (
        <Card><Empty icon={Flag} title={t('Ралито се подготвя')}>{t('Маршрутът на седмицата се обявява до половин час след началото ѝ.')}</Empty></Card>
      ) : (
        <>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 font-display text-xl font-bold"><Flag className="h-5 w-5 text-orange-400" />{tx(rally.from)} → {tx(rally.to)}</div>
                <div className="mt-1 text-sm text-mist-300"><span className="num">{t('{0} км', int(rally.distanceKm))}</span>{' '}{t('· край {0} · записани {1}', dateTime(rally.endsAt), results!.entries)}</div>
              </div>
              {!mine ? (
                <ActionButton className="btn-primary" action={{ type: 'joinRally' }}>{t('Запиши се')}</ActionButton>
              ) : mine.finishedAt ? (
                <Badge tone="green">{t('Финишира: {0} · {1}/100 км', hm(mine.minutes ?? 0), money(mine.fuelCentsPer100 ?? 0))}</Badge>
              ) : (
                <Link href={`/game/contracts?from=${rally.originCityId}`} className="btn-primary">{t('Към товара в {0}', rally.from)}</Link>
              )}
            </div>
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            {(['fastest', 'eco'] as RallyCategory[]).map((cat) => (
              <Card key={cat} title={tx(RALLY_CATEGORIES[cat])}>
                {results![cat].length === 0 ? (
                  <p className="text-sm text-mist-400">{t('Още никой не е финиширал.')}</p>
                ) : (
                  <ol className="space-y-1.5 text-sm">
                    {results![cat].slice(0, 10).map((r, i) => (
                      <li key={r.userId} className={`flex justify-between gap-2 ${r.userId === user.id ? 'text-gold-400' : ''}`}>
                        <span>{i < 3 ? ['🥇', '🥈', '🥉'][i] : `${i + 1}.`} {tx(r.username)}</span>
                        <span className="num">{cat === 'fastest' ? hm(r.minutes) : t('{0}/100 км', money(r.fuelCentsPer100))}</span>
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
