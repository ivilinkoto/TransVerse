import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Card, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { PostcardClient } from '@/components/garage/PostcardClient';
import { date, int } from '@/lib/format';
import { gameContext } from '@/server/game/context';
import { postcardView } from '@/server/game/postcards';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('3D картичка') };
}

/** 1.2.3.6: the 3D postcard of a trip — any player may look at it (it is shared in the chat). */
export default async function PostcardPage({ params }: { params: Promise<{ id: string }> }) {
  await initLocale();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { db, user, features } = await gameContext();
  if (!features.delivery_postcard) notFound();
  const card = await postcardView(db, id);
  if (!card) notFound();
  const mine = card.ownerId === user.id;
  const title = card.reason === 'first_city' ? t('Поздрави от {0}!', tx(card.city)) : t('{0} км до {1}', int(card.km), tx(card.city));
  const line = t('{0} · {1} · {2} → {3} · {4}', card.username, tx(card.goods), tx(card.from), tx(card.city), date(card.completedAt));
  return (
    <div className="space-y-6">
      <PageHeader title={t('📸 3D картичка')} subtitle={card.reason === 'first_city' ? t('Първият курс на {0} до {1}.', card.username, tx(card.city)) : t('Дълъг курс на {0}: {1} км.', card.username, int(card.km))} actions={mine ? <Link href={`/game/trips/${card.id}`} className="btn-ghost">{t('← Курсът')}</Link> : undefined} />
      <Card>
        <PostcardClient data={{ scene: card.scene, title, line, truck: card.truck }} />
      </Card>
      {mine && (
        <Card title={t('Покажи я')}>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-mist-300">{t('Сложи картичката в глобалния чат — всеки ще види камиона ти в 3D.')}</p>
            <ActionButton action={{ type: 'sharePostcard', deliveryId: card.id }} className="btn-primary">{t('💬 Покажи в чата')}</ActionButton>
          </div>
        </Card>
      )}
    </div>
  );
}
