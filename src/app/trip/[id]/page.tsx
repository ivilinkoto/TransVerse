import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { appUrl } from '@/server/discord/config';
import { getDb } from '@/server/db/client';
import { tripLog } from '@/server/game/trip-log';
import { t as tr, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return {};
  const t = await tripLog(getDb(), id, { publicOnly: true });
  if (!t) return {};
  const title = tr('{0} → {1} · {2} в TransVerse', t.from, t.to, t.username);
  const description = tr('{0} км с {1}{2}. Карай и ти — безплатна игра с камиони по реални пътища.', Math.round(t.km), t.goods, t.late ? '' : tr(', навреме'));
  return { title, description, openGraph: { title, description, images: [{ url: `${appUrl()}/api/trip-card/${id}`, width: 1200, height: 630 }] }, twitter: { card: 'summary_large_image', title, description } };
}

/** A shared trip, public (the player chose to share it). */
export default async function PublicTripPage({ params }: Props) {
  await initLocale();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const t = await tripLog(getDb(), id, { publicOnly: true });
  if (!t) notFound();
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/trip-card/${id}`} alt={`${t.from} → ${t.to}`} width={1200} height={630} className="w-full rounded-2xl border border-asphalt-700" />
      <div className="space-y-2 text-center">
        <h1 className="font-display text-3xl font-bold">{tx(t.from)} → {tx(t.to)}</h1>
        <p className="text-mist-300">{tr('{0} закара {1} ({2} т) — {3} км по реален маршрут.', t.username, t.goods, t.tons, Math.round(t.km))}</p>
        <p className="text-xs text-mist-500">{tr('Игрови данни от TransVerse.')}</p>
        <Link href="/register" className="btn-primary mt-4 inline-flex">{tr('Карай и ти — безплатно')}</Link>
      </div>
    </main>
  );
}
