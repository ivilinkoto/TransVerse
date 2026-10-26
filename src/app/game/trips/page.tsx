import { NotebookPen } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { dateTime, km, money } from '@/lib/format';
import { gameContext } from '@/server/game/context';
import { tripsOf } from '@/server/game/trip-log';
import { t as tr, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: tr('Бордови дневник') };
}

export default async function TripsPage() {
  await initLocale();
  const { db, user, features } = await gameContext();
  if (!features.trip_log) notFound();
  const trips = await tripsOf(db, user.id);
  return (
    <div className="space-y-6">
      <PageHeader title={tr('Бордови дневник')} subtitle={tr('Всеки завършен курс: маршрут, време на волана, почивки, граници и картичка за споделяне.')} />
      <Card>
        {trips.length === 0 ? (
          <Empty icon={NotebookPen} title={tr('Още няма завършени курсове')}>{tr('Първият курс ще се появи тук, щом пристигне.')}</Empty>
        ) : (
          <ul className="divide-y divide-asphalt-800 text-sm">
            {trips.map((t) => (
              <li key={t.id}>
                <Link href={`/game/trips/${t.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 hover:text-white">
                  <span className="min-w-0"><span className="font-medium">{tx(t.from)} → {tx(t.to)}</span> <span className="text-mist-400">· {tx(t.goods)} · {km(t.loadedKm + t.emptyKm)}</span></span>
                  <span className="flex items-center gap-2">
                    {t.sharedAt && <Badge tone="violet">{tr('споделен')}</Badge>}
                    <Badge tone={t.late ? 'red' : 'green'}>{t.late ? tr('закъснял') : tr('навреме')}</Badge>
                    <span className="num text-xs text-mist-400">{money(t.payoutCents ?? 0)} · {t.completedAt ? dateTime(t.completedAt) : ''}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
