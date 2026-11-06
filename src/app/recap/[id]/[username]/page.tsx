import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from 'drizzle-orm';
import type { Metadata } from 'next';
import { SeasonRecapCard } from '@/components/game/SeasonRecapCard';
import { featureLive } from '@/lib/game/features';
import { getDb } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { seasonRecap } from '@/server/game/final-sprint';
import { OG_IMAGE } from '@/server/site';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

type Props = { params: Promise<{ id: string; username: string }> };

async function load({ params }: Props) {
  const { id, username } = await params;
  const seasonId = Number(id);
  if (!Number.isInteger(seasonId) || !featureLive('final_sprint', new Date())) return null;
  const name = decodeURIComponent(username);
  const [u] = await getDb().select({ id: users.id, username: users.username }).from(users).where(sql`lower(${users.username}) = lower(${name})`);
  if (!u) return null;
  const recap = await seasonRecap(getDb(), seasonId, u.id);
  return recap ? { recap, username: u.username } : null;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  await initLocale();
  const r = await load(props).catch(() => null);
  if (!r) return {};
  const title = t('{0} в {1}: място #{2}', r.username, tx(r.recap.season.name), r.recap.place ?? '—');
  const description = t('{0} доставки и {1} км с товар. Карай и ти — безплатна игра с камиони по реални пътища.', r.recap.deliveries, r.recap.km);
  return { title, description, openGraph: { title, description, images: [OG_IMAGE] }, twitter: { card: 'summary_large_image', title, description } };
}

/** 1.2.3.1: a player's season, public (shared from the game). */
export default async function PublicRecapPage(props: Props) {
  await initLocale();
  const r = await load(props);
  if (!r) notFound();
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <SeasonRecapCard recap={r.recap} username={r.username} />
      <div className="space-y-2 text-center">
        <p className="text-xs text-mist-500">{t('Игрови данни от TransVerse.')}</p>
        <Link href="/register?src=season-recap" className="btn-primary mt-2 inline-flex">{t('Карай и ти — безплатно')}</Link>
      </div>
    </main>
  );
}
