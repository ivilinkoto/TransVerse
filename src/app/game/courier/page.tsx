import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Card, PageHeader } from '@/components/ui';
import { CourierGame } from '@/components/game/CourierGame';
import { int } from '@/lib/format';
import { COURIER } from '@/lib/game/courier';
import { COURIER_CITIES, courierCity } from '@/lib/game/courier-graph';
import { gameContext } from '@/server/game/context';
import { courierRanking, courierView } from '@/server/game/courier';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Градски куриер') };
}

/** 1.4 „Градски куриер“: the day's parcels in the real centre of a city, the player's shifts and the day's best. */
export default async function CourierPage({ searchParams }: { searchParams: Promise<{ city?: string }> }) {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.city_courier) notFound();
  const city = courierCity((await searchParams).city ?? '')?.id ?? 'sofia';
  const [view, ranking] = await Promise.all([courierView(db, user.id, now), courierRanking(db, city, now)]);
  return (
    <div className="space-y-4">
      <PageHeader title={t('Градски куриер')} subtitle={t('8 пратки по истинските улици на центъра за {0} минути.', COURIER.limitS / 60)}
        help={t('Натисни кръстовище и бусът тръгва по най-краткия път. Навигацията не знае задръстванията (червено) — добави спирки, за да ги заобиколиш.')} />
      <nav className="flex gap-2" aria-label={t('Град')}>
        {COURIER_CITIES.map((c) => (
          <Link key={c.id} href={`/game/courier?city=${c.id}`} className={`rounded-xl px-3 py-1.5 text-sm font-semibold ${c.id === city ? 'bg-cyan-glow text-asphalt-950' : 'bg-asphalt-800 text-mist-200'}`} data-testid={`courier-city-${c.id}`}>{tx(c.name)}</Link>
        ))}
      </nav>
      <CourierGame city={city} day={view.day} runsLeft={view.runsLeft} />
      <Card title={t('Днешните най-добри · {0}', tx(courierCity(city)!.name))}>
        {ranking.length === 0 ? <p className="text-sm text-mist-400">{t('Още никой не е карал днес.')}</p> : (
          <ol className="space-y-1 text-sm" data-testid="courier-ranking">
            {ranking.map((r, i) => <li key={r.userId} className={`flex justify-between gap-2 ${r.userId === user.id ? 'font-semibold text-gold-300' : ''}`}><span>{i + 1}. {r.username}</span><span className="num">{'★'.repeat(r.stars)} · {int(r.points)}</span></li>)}
          </ol>
        )}
      </Card>
    </div>
  );
}
