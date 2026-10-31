import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { Star } from 'lucide-react';
import { dateTime } from '@/lib/format';
import { MYSTERY, REVIEWS, starLine } from '@/lib/game/reviews';
import { PROMISES, type PromiseId } from '@/lib/game/promise';
import { gameContext } from '@/server/game/context';
import { reviewsOf, starsOf } from '@/server/game/trip-extras';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Отзиви') };
}

/** 1.1.4.2: what the clients said about the last trips; the mystery client's checks. */
export default async function ReviewsPage() {
  await initLocale();
  const { db, user, features } = await gameContext();
  if (!features.client_reviews) notFound();
  const [summary, list] = await Promise.all([starsOf(db, user.id), reviewsOf(db, user.id, 30)]);
  return (
    <div className="space-y-6">
      <PageHeader title={t('Отзиви от клиентите')} subtitle={t('Всяка доставка получава 1–5 звезди. Средно {0}+ от поне {1} курса — по-добри клиенти (+{2}%).', REVIEWS.goodAverage, REVIEWS.minTrips, Math.round(REVIEWS.goodClientShare * 100))} />
      <Card title={t('Средна оценка')}>
        <p className="font-display text-3xl text-gold-400">{summary.average != null ? `${summary.average} ★` : '—'}</p>
        <p className="mt-1 text-sm text-mist-400">{t('От последните {0} курса.', summary.trips)} {summary.good && <Badge tone="green">{t('Доволни клиенти · +{0}%', Math.round(REVIEWS.goodClientShare * 100))}</Badge>}</p>
        <p className="mt-3 text-xs text-mist-400">{t('Веднъж седмично един курс е проверка от тайния клиент. Пет звезди носят +{0} ТрансКоин и значка.', MYSTERY.coins)}</p>
      </Card>
      <Card title={t('Последни доставки')}>
        {!list.length ? <Empty icon={Star} title={t('Още няма отзиви')}>{t('Първата оценка идва с първата доставка.')}</Empty> : (
          <ul className="divide-y divide-asphalt-800 text-sm">
            {list.map((r) => (
              <li key={r.deliveryId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="text-gold-400">{starLine(r.stars ?? 0)}</span> <span className="font-medium">{tx(r.goods)} → {tx(r.to)}</span>
                  {r.mystery && <Badge tone="violet">{t('🕵 Тайният клиент')}</Badge>}
                  {r.fog && <Badge tone="neutral">{t('🌫 Мъгла')}</Badge>}
                  {r.promise && r.promise !== 'normal' && <Badge tone="cyan">{PROMISES[r.promise as PromiseId]?.emoji} {tx(PROMISES[r.promise as PromiseId]?.label ?? '')}</Badge>}
                  {r.puzzle && <Badge tone="blue">{t('📦 {0}%', Math.round(r.puzzle.fill * 100))}</Badge>}
                </span>
                <span className="text-xs text-mist-400">{r.at ? dateTime(r.at) : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
