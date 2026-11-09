import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { GarageClient } from '@/components/garage/GarageClient';
import { Badge, PageHeader } from '@/components/ui';
import { users } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';
import { garageView } from '@/server/game/showroom';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  await initLocale();
  return { title: t('Гаражът на {0}', decodeURIComponent((await params).username)) };
}

/** 1.2.3.5: a visit to another player's garage — look round, leave a 👍 and a note. */
export default async function VisitGaragePage({ params }: { params: Promise<{ username: string }> }) {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.garage_showroom) notFound();
  const name = decodeURIComponent((await params).username);
  const [owner] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = lower(${name}) and ${users.bannedAt} is null`);
  if (!owner) notFound();
  const view = await garageView(db, owner.id, user.id, now);
  if (!view) notFound();
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('🏁 Гаражът на {0}', view.owner.username)}
        subtitle={view.mine ? t('Така те виждат гостите.') : t('Разгледай камионите, влез в кабината и остави 👍.')}
        actions={<Badge tone="cyan">{tx(view.hall.label)}</Badge>}
      />
      <GarageClient view={view} />
      <p className="text-xs"><Link href="/game/showroom" className="text-cyan-glow hover:underline">{t('← Към моя гараж')}</Link></p>
    </div>
  );
}
