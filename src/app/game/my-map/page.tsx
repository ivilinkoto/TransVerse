import { notFound } from 'next/navigation';
import { Card, PageHeader, Stat } from '@/components/ui';
import { int } from '@/lib/format';
import { gameContext } from '@/server/game/context';
import { footprint } from '@/server/game/footprint';
import { FootprintClient } from './FootprintClient';

export const metadata = { title: 'Картата ми' };

/** v1.6: where the player has been — real cities and the real routes they drove. */
export default async function MyMapPage() {
  const { db, user, hq, features } = await gameContext();
  if (!features.my_map) notFound();
  const data = await footprint(db, user.id);
  return (
    <div className="space-y-6">
      <PageHeader title="Картата ми" subtitle="Градовете, до които си доставял, и линиите, които си карал с товар (по-дебела линия — повече курсове)." />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Градове" value={int(data.cities.length)} />
        <Stat label="Държави" value={int(data.countries)} />
        <Stat label="Курсове" value={int(data.trips)} />
        <Stat label="Километри" value={int(data.km)} />
      </div>
      <FootprintClient styleUrl={process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/dark'} center={[hq.lat, hq.lon]} data={{ cities: data.cities, lanes: data.lanes }} />
      {data.lanes.length > 0 && (
        <Card title="Най-често карани линии">
          <ul className="divide-y divide-white/5 text-sm">
            {data.lanes.slice(0, 10).map((l) => <li key={l.name} className="flex justify-between py-1.5"><span>{l.name}</span><span className="num">{l.trips} {l.trips === 1 ? 'курс' : 'курса'} · {int(l.km)} км</span></li>)}
          </ul>
        </Card>
      )}
    </div>
  );
}
