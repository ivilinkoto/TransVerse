import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ReplyForm } from '@/components/support/ReplyForm';
import { Thread } from '@/components/support/Thread';
import { Badge, Card, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { adminContext } from '@/server/admin-context';
import { GameError } from '@/server/game/errors';
import { TICKET_CATEGORIES, TICKET_STATUS, ticketThread } from '@/server/game/support';
import { t as tr, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: tr('Запитване') };
}

export default async function AdminTicket({ params }: { params: Promise<{ id: string }> }) {
  await initLocale();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { db, user } = await adminContext();
  const thread = await ticketThread(db, user, id).catch((e) => {
    if (e instanceof GameError) notFound();
    throw e;
  });
  const t = thread.ticket;
  return (
    <div className="space-y-6">
      <PageHeader
        title={tx(t.subject)}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2">{tr('От')}{' '}<Link className="text-cyan-glow hover:underline" href={`/admin/users/${thread.owner.id}`}>{tx(thread.owner.username)}</Link> ({tx(thread.owner.email)})<Badge>{tx(TICKET_CATEGORIES[t.category as keyof typeof TICKET_CATEGORIES])}</Badge><Badge tone="gold">{tx(TICKET_STATUS[t.status as keyof typeof TICKET_STATUS])}</Badge>{thread.assignee ? tr('· отговорник: {0}', thread.assignee) : tr('· без отговорник')}</span>}
        actions={
          <>
            {!thread.assignee && <ActionButton endpoint="/api/admin/action" action={{ type: 'ticketAssign', ticketId: id }}>{tr('Поеми')}</ActionButton>}
            {t.status !== 'closed' ? <ActionButton endpoint="/api/admin/action" action={{ type: 'ticketStatus', ticketId: id, status: 'closed' }}>{tr('Затвори')}</ActionButton> : <ActionButton endpoint="/api/admin/action" action={{ type: 'ticketStatus', ticketId: id, status: 'open' }}>{tr('Отвори отново')}</ActionButton>}
          </>
        }
      />
      <Thread messages={thread.messages} />
      <Card title={tr('Отговор от поддръжката')}><ReplyForm endpoint="/api/admin/action" action={{ type: 'ticketReply', ticketId: id }} /></Card>
    </div>
  );
}
