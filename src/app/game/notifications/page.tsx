import { Bell } from 'lucide-react';
import Link from 'next/link';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { gameContext } from '@/server/game/context';
import { markNotificationsRead } from '@/server/game/notify';
import { latestNotifications } from '@/server/game/queries';
import { categoryOf, type PushCategory } from '@/server/push';
import { digest } from '@/lib/game/digest';
import { t, tx, intlLocale } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Известия') };
}

/** 1.1.3: the filters on top of the list, each a group of notification categories. */
const FILTERS: { id: string; label: string; categories: PushCategory[] }[] = [
  { id: 'trips', label: 'Курсове', categories: ['deliveries', 'urgent', 'favorites', 'fines', 'clients'] },
  { id: 'company', label: 'Компания', categories: ['company'] },
  { id: 'chat', label: 'Съобщения', categories: ['chat'] },
  { id: 'events', label: 'Ивенти и мисии', categories: ['events', 'holiday', 'news'] },
  { id: 'other', label: 'Други', categories: ['general'] },
];

const DOT = { success: 'bg-profit', warning: 'bg-amber-sig', achievement: 'bg-prestige', info: 'bg-volt-400' } as const;

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  const all = await latestNotifications(db, user.id, 100);
  const wanted = (await searchParams).f;
  const filter = features.notification_filter ? FILTERS.find((f) => f.id === wanted) : undefined;
  const list = filter ? all.filter((n) => filter.categories.includes(categoryOf(n.href))) : all;
  // Opening the page reads everything; this visit still highlights what was new.
  if (all.some((n) => !n.readAt)) await markNotificationsRead(db, user.id);
  return (
    <div className="space-y-6">
      <PageHeader title={t('Известия')} subtitle={t('Доставки, постижения, нива и събития в компанията. Пристигат на живо.')} />
      {features.notification_filter && (
        <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0" aria-label={t('Филтър')}>
          {[{ id: '', label: 'Всички' }, ...FILTERS].map((f) => {
            const active = (filter?.id ?? '') === f.id;
            return <Link key={f.id} href={f.id ? `/game/notifications?f=${f.id}` : '/game/notifications'} aria-current={active ? 'page' : undefined} className={`shrink-0 rounded-full border px-3 py-1.5 text-sm transition ${active ? 'border-volt-500 bg-volt-500/20 text-white' : 'border-asphalt-700 text-mist-300 hover:text-white'}`}>{tx(f.label)}</Link>;
          })}
        </nav>
      )}
      <Card>
        {list.length === 0 ? <Empty icon={Bell} title={t('Няма известия')} /> : (
          <ul className="divide-y divide-asphalt-800">
            {(features.notification_digest ? digest(list) : list.map((n) => ({ kind: 'one' as const, items: [n], day: '', count: 1, netLv: 0 }))).map((g) => g.kind === 'group' ? (
              <li key={g.items[0]!.id} className="py-3">
                <details>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-semibold"><span className="h-2.5 w-2.5 rounded-full bg-profit" />{t('{0}: {1} курса пристигнаха', g.day === new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia' }).format(now) ? t('Днес') : g.day.split('-').reverse().join('.'), g.count)}{g.items.some((n) => !n.readAt) && <Badge tone="cyan">{t('Ново')}</Badge>}</span>
                    <span className={`num text-sm ${g.netLv >= 0 ? 'text-profit' : 'text-loss'}`}>{t('нетно {0}{1} лв. ▾', g.netLv >= 0 ? '+' : '', g.netLv.toLocaleString(intlLocale()))}</span>
                  </summary>
                  <ul className="mt-2 space-y-1 border-l border-asphalt-700 pl-3 text-sm text-mist-300">
                    {g.items.map((n) => <li key={n.id}>{tx(n.title)} — {tx(n.body)}</li>)}
                  </ul>
                </details>
              </li>
            ) : g.items.map((n) => (
              <li key={n.id} className={`flex gap-3 py-3 ${n.readAt ? 'opacity-70' : ''}`}>
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[n.kind as keyof typeof DOT] ?? 'bg-volt-400'}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-semibold">{tx(n.title)}{!n.readAt && <Badge tone="cyan">{t('Ново')}</Badge>}</span>
                    <span className="text-xs text-mist-400">{dateTime(n.createdAt)}</span>
                  </div>
                  <p className="text-sm text-mist-300">{tx(n.body)}</p>
                  {n.href && <Link href={n.href} className="text-xs text-cyan-glow hover:underline">{t('Отвори →')}</Link>}
                </div>
              </li>
            )))}
          </ul>
        )}
      </Card>
    </div>
  );
}
