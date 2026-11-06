import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { SeasonRecapCard } from '@/components/game/SeasonRecapCard';
import { appUrl } from '@/server/discord/config';
import { gameContext } from '@/server/game/context';
import { seasonRecap } from '@/server/game/final-sprint';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Твоят сезон') };
}

/** 1.2.3.1: the player's own season, with the link to share it. */
export default async function SeasonRecapPage({ params }: { params: Promise<{ id: string }> }) {
  await initLocale();
  const { db, user, features } = await gameContext();
  if (!features.final_sprint) notFound();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const recap = await seasonRecap(db, id, user.id);
  if (!recap) notFound();
  const link = `${appUrl()}/recap/${id}/${encodeURIComponent(user.username)}?src=season-recap`;
  return (
    <div className="space-y-6">
      <Link href="/game/seasons" className="inline-flex items-center gap-1 text-sm text-mist-300 hover:text-white"><ArrowLeft className="h-4 w-4" />{t('Към сезона')}</Link>
      <SeasonRecapCard recap={recap} username={user.username} />
      <div className="flex flex-wrap gap-2">
        <a className="btn-primary" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`} target="_blank" rel="noopener noreferrer" data-testid="share-recap">{t('Сподели във Facebook')}</a>
        <a className="btn-ghost" href={link} target="_blank" rel="noopener noreferrer">{t('Публичната страница')}</a>
      </div>
    </div>
  );
}
