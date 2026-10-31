import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getDb } from '@/server/db/client';
import { trackView } from '@/server/game/tracking';
import { LiveTrip } from './LiveTrip';
import { t as tr, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: tr('Курс на живо · TransVerse'), description: tr('Проследи камиона по реалния маршрут. Карай и ти — безплатна игра с камиони.'), robots: { index: false } };
}

/** 1.1.4.2: a trip shared to follow live (public, no money shown). */
export default async function TrackPage({ params }: Props) {
  await initLocale();
  const { token } = await params;
  const v = await trackView(getDb(), token);
  if (!v) notFound();
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <div className="space-y-1 text-center">
        <p className="label">{tr('На живо')}</p>
        <h1 className="font-display text-3xl font-bold">{tx(v.from)} → {tx(v.to)}</h1>
        <p className="text-mist-300">{tr('{0} кара {1} с {2} — {3} км.', v.username, v.goods, v.nickname || v.plate, Math.round(v.km))}</p>
      </div>
      <LiveTrip startedAt={v.startedAt.toISOString()} etaAt={v.etaAt.toISOString()} done={v.status === 'completed'} from={{ lat: v.fromLat, lon: v.fromLon, name: tx(v.from) }} to={{ lat: v.toLat, lon: v.toLon, name: tx(v.to) }} />
      <div className="text-center">
        <p className="text-xs text-mist-500">{tr('Игрови данни от TransVerse. Градовете и разстоянието са реални.')}</p>
        <Link href="/register" className="btn-primary mt-4 inline-flex">{tr('Карай и ти — безплатно')}</Link>
      </div>
    </main>
  );
}
