import { Bell, CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { Card, Empty, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { dateTime } from '@/lib/format';
import { gameContext } from '@/server/game/context';
import { latestNotifications } from '@/server/game/queries';

export const metadata = { title: 'Известия' };

const DOT = { success: 'bg-profit', warning: 'bg-amber-sig', achievement: 'bg-prestige', info: 'bg-volt-400' } as const;

export default async function NotificationsPage() {
  const { db, user } = await gameContext();
  const list = await latestNotifications(db, user.id, 100);
  const unread = list.filter((n) => !n.readAt).length;
  return (
    <div className="space-y-6">
      <PageHeader title="Известия" subtitle="Доставки, постижения, нива и събития в компанията. Пристигат на живо." actions={unread > 0 ? <ActionButton action={{ type: 'markNotificationsRead' }}><CheckCheck className="h-4 w-4" />Маркирай всички като прочетени</ActionButton> : undefined} />
      <Card>
        {list.length === 0 ? <Empty icon={Bell} title="Няма известия" /> : (
          <ul className="divide-y divide-asphalt-800">
            {list.map((n) => (
              <li key={n.id} className={`flex gap-3 py-3 ${n.readAt ? 'opacity-70' : ''}`}>
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[n.kind as keyof typeof DOT] ?? 'bg-volt-400'}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{n.title}</span>
                    <span className="text-xs text-mist-400">{dateTime(n.createdAt)}</span>
                  </div>
                  <p className="text-sm text-mist-300">{n.body}</p>
                  {n.href && <Link href={n.href} className="text-xs text-cyan-glow hover:underline">Отвори →</Link>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
