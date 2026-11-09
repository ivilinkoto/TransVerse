import { Bell } from 'lucide-react';
import Link from 'next/link';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { gameContext } from '@/server/game/context';
import { markNotificationsRead } from '@/server/game/notify';
import { latestNotifications } from '@/server/game/queries';
import { categoryOf, type PushCategory } from '@/server/push';
import { digest } from '@/lib/game/digest';
import { ActionButton } from '@/components/ui/ActionButton';
import { notificationButtons } from '@/lib/game/notification-buttons';
import { t, tx, intlLocale } from '@/i18n/t';
import { NotificationCenter } from '@/components/gameui/NotificationCenter';
import { int } from '@/lib/format';

/** 1.1.3: the filters on top of the list, each a group of notification categories. */
const FILTERS: { id: string; label: string; categories: PushCategory[] }[] = [
  { id: 'trips', label: 'Курсове', categories: ['deliveries', 'urgent', 'favorites', 'fines', 'clients'] },
  { id: 'company', label: 'Компания', categories: ['company'] },
  { id: 'chat', label: 'Съобщения', categories: ['chat'] },
  { id: 'events', label: 'Ивенти и мисии', categories: ['events', 'holiday', 'news'] },
  { id: 'other', label: 'Други', categories: ['general'] },
];

const DOT = { success: 'bg-profit', warning: 'bg-amber-sig', achievement: 'bg-prestige', info: 'bg-volt-400' } as const;

/** 1.2.3.6 „Нов облик“: the look of each filter (icon and colour of its cards). */
const LOOK: Record<string, { icon: string; colour: string }> = {
  trips: { icon: '🚚', colour: '#22d3ee' },
  company: { icon: '🏢', colour: '#a78bfa' },
  chat: { icon: '💬', colour: '#34d399' },
  events: { icon: '🎉', colour: '#f6c343' },
  other: { icon: '🔔', colour: '#94a3b8' },
};
const KIND_ICON: Record<string, string> = { achievement: '🏆', warning: '⚠️' };

/** The notifications list; shared by the page and the game window. */
export async function NotificationsView({ wanted, inWindow = false }: { wanted?: string; inWindow?: boolean }) {
  const { db, user, now, features } = await gameContext();
  const all = await latestNotifications(db, user.id, 100);
  const filter = features.notification_filter ? FILTERS.find((f) => f.id === wanted) : undefined;
  const list = filter ? all.filter((n) => filter.categories.includes(categoryOf(n.href))) : all;
  // Opening the page reads everything; this visit still highlights what was new.
  if (all.some((n) => !n.readAt)) await markNotificationsRead(db, user.id);
  if (features.game_ui) {
    const tabOf = (href: string | null) => FILTERS.find((f) => f.categories.includes(categoryOf(href)))?.id ?? 'other';
    const groups = features.notification_digest ? digest(all) : all.map((n) => ({ kind: 'one' as const, items: [n], day: '', count: 1, netLv: 0 }));
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia' }).format(now);
    const items = groups.map((g) => {
      const n = g.items[0]!;
      const tab = tabOf(n.href);
      const look = LOOK[tab]!;
      const fresh = g.items.some((x) => !x.readAt);
      const style = { '--tile': n.kind === 'achievement' ? '#f6c343' : look.colour } as React.CSSProperties;
      const icon = KIND_ICON[n.kind] ?? look.icon;
      const node = g.kind === 'group' ? (
        <details className={`notif-card rounded-2xl ${fresh ? 'notif-new' : ''}`} style={style}>
          <summary className="flex cursor-pointer list-none items-center gap-3 p-3">
            <span className="notif-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-2xl" aria-hidden>📦</span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-white">{t('{0}: {1} курса пристигнаха', g.day === today ? t('Днес') : g.day.split('-').reverse().join('.'), g.count)}</span>
              <span className={`num text-sm font-bold ${g.netLv >= 0 ? 'text-profit' : 'text-loss'}`}>{t('нетно {0}{1} лв. ▾', g.netLv >= 0 ? '+' : '', int(g.netLv))}</span>
            </span>
            {fresh && <span className="notif-badge">{t('Ново')}</span>}
          </summary>
          <ul className="space-y-1 border-t border-white/5 px-4 py-2 text-sm text-mist-300">
            {g.items.map((x) => <li key={x.id}>{tx(x.title)} — {tx(x.body)}</li>)}
          </ul>
        </details>
      ) : (
        <div className={`notif-card flex gap-3 rounded-2xl p-3 ${fresh ? 'notif-new' : ''}`} style={style}>
          <span className="notif-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-2xl" aria-hidden>{icon}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-x-2">
              <span className="font-semibold text-white">{tx(n.title)}</span>
              <span className="flex items-center gap-2 text-[11px] text-mist-400">{fresh && <span className="notif-badge">{t('Ново')}</span>}{dateTime(n.createdAt)}</span>
            </div>
            <p className="text-sm text-mist-300">{tx(n.body)}</p>
            {(n.href || (features.notification_buttons && notificationButtons(n.href).length > 0)) && (
              <div className="mt-2 flex flex-wrap gap-2">
                {features.notification_buttons && notificationButtons(n.href).map((b) => <ActionButton key={b.label} action={b.action} className={`game-action flex-row px-3 py-1.5 text-xs ${b.primary ? 'game-action-main' : ''}`}>{tx(b.label)}</ActionButton>)}
                {n.href && <Link href={n.href} className="game-action flex-row px-3 py-1.5 text-xs">{t('Отвори →')}</Link>}
              </div>
            )}
          </div>
        </div>
      );
      return { key: String(n.id), tab, fresh, node };
    });
    const tabs = (features.notification_filter ? FILTERS : []).map((f) => ({ id: f.id, label: f.label, icon: LOOK[f.id]!.icon }));
    const fresh = all.filter((n) => !n.readAt).length;
    return (
      <div className="space-y-3">
        {!inWindow && <PageHeader title={t('Известия')} subtitle={t('Доставки, постижения, нива и събития в компанията. Пристигат на живо.')} />}
        <p className="text-sm text-mist-300">{fresh > 0 ? t('{0} нови от последния път.', fresh) : t('Нищо ново — всичко е прочетено.')}</p>
        <NotificationCenter tabs={tabs} items={items} initial={filter?.id} />
      </div>
    );
  }
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
                  {features.notification_buttons && notificationButtons(n.href).length > 0 && (
                    <div className="my-1.5 flex flex-wrap gap-2">
                      {notificationButtons(n.href).map((b) => <ActionButton key={b.label} action={b.action} className={b.primary ? 'btn-primary px-3 py-1 text-xs' : 'btn-ghost px-3 py-1 text-xs'}>{tx(b.label)}</ActionButton>)}
                    </div>
                  )}
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
