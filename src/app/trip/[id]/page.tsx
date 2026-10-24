import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { appUrl } from '@/server/discord/config';
import { getDb } from '@/server/db/client';
import { tripLog } from '@/server/game/trip-log';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return {};
  const t = await tripLog(getDb(), id, { publicOnly: true });
  if (!t) return {};
  const title = `${t.from} → ${t.to} · ${t.username} в TransVerse`;
  const description = `${Math.round(t.km)} км с ${t.goods}${t.late ? '' : ', навреме'}. Карай и ти — безплатна игра с камиони по реални пътища.`;
  return { title, description, openGraph: { title, description, images: [{ url: `${appUrl()}/api/trip-card/${id}`, width: 1200, height: 630 }] }, twitter: { card: 'summary_large_image', title, description } };
}

/** A shared trip, public (the player chose to share it). */
export default async function PublicTripPage({ params }: Props) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const t = await tripLog(getDb(), id, { publicOnly: true });
  if (!t) notFound();
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/trip-card/${id}`} alt={`${t.from} → ${t.to}`} width={1200} height={630} className="w-full rounded-2xl border border-asphalt-700" />
      <div className="space-y-2 text-center">
        <h1 className="font-display text-3xl font-bold">{t.from} → {t.to}</h1>
        <p className="text-mist-300">{t.username} закара {t.goods} ({t.tons} т) — {Math.round(t.km)} км по реален маршрут.</p>
        <p className="text-xs text-mist-500">Игрови данни от TransVerse.</p>
        <Link href="/register" className="btn-primary mt-4 inline-flex">Карай и ти — безплатно</Link>
      </div>
    </main>
  );
}
