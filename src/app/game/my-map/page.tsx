import { inArray } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, PageHeader, Stat } from '@/components/ui';
import { int } from '@/lib/format';
import { playableCountries } from '@/lib/geo/scope';
import { countries } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';
import { footprint } from '@/server/game/footprint';
import { FootprintClient } from './FootprintClient';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Картата ми') };
}

/** v1.6: where the player has been — real cities and the real routes they drove. */
export default async function MyMapPage() {
  await initLocale();
  const { db, user, hq, features } = await gameContext();
  if (!features.my_map) notFound();
  const data = await footprint(db, user.id);
  // v1.7: the countries of the game, how many cities the player reached in each, and a page for each.
  const playable = playableCountries(features.europe);
  const names = features.country_map ? new Map((await db.select({ code: countries.code, nameBg: countries.nameBg }).from(countries).where(inArray(countries.code, [...playable]))).map((c) => [c.code, c.nameBg])) : null;
  const perCountry = new Map<string, number>();
  for (const c of data.cities) perCountry.set(c.country, (perCountry.get(c.country) ?? 0) + 1);
  return (
    <div className="space-y-6">
      <PageHeader title={t('Картата ми')} subtitle={t('Градовете, до които си доставял, и линиите, които си карал с товар (по-дебела линия — повече курсове).')} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t('Градове')} value={int(data.cities.length)} />
        <Stat label={t('Държави')} value={names ? `${int(data.countries)} / ${playable.length}` : int(data.countries)} />
        <Stat label={t('Курсове')} value={int(data.trips)} />
        <Stat label={t('Километри')} value={int(data.km)} />
      </div>
      <FootprintClient styleUrl={process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/dark'} center={[hq.lat, hq.lon]} data={{ cities: data.cities, lanes: data.lanes }} />
      {names && (
        <Card title={t('Държавите')}>
          <div className="flex flex-wrap gap-2">
            {[...playable].sort((a, b) => (names.get(a) ?? a).localeCompare(names.get(b) ?? b, 'bg')).map((code) => {
              const n = perCountry.get(code) ?? 0;
              return (
                <Link key={code} href={`/game/countries/${code}`} className={`rounded-full px-2.5 py-1 text-xs hover:text-cyan-glow ${n ? 'bg-profit/15 text-profit' : 'bg-asphalt-850 text-mist-400'}`}>
                  {n ? '✓ ' : ''}{names.get(code) ?? code}{n ? <span className="num ml-1">· {n}</span> : null}
                </Link>
              );
            })}
          </div>
        </Card>
      )}
      {data.lanes.length > 0 && (
        <Card title={t('Най-често карани линии')}>
          <ul className="divide-y divide-white/5 text-sm">
            {data.lanes.slice(0, 10).map((l) => <li key={l.name} className="flex justify-between py-1.5"><span>{tx(l.name)}</span><span className="num">{t('{0} {1} · {2} км', l.trips, l.trips === 1 ? t('курс') : t('курса'), int(l.km))}</span></li>)}
          </ul>
        </Card>
      )}
    </div>
  );
}
