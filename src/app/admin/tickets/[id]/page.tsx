import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ReplyForm } from '@/components/support/ReplyForm';
import { Thread } from '@/components/support/Thread';
import { Badge, Card, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { adminContext } from '@/server/admin-context';
import { GameError } from '@/server/game/errors';
import { TICKET_CATEGORIES, TICKET_STATUS, ticketThread } from '@/server/game/support';

export const metadata = { title: 'Запитване' };

export default async function AdminTicket({ params }: { params: Promise<{ id: string }> }) {
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
        title={t.subject}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2">От <Link className="text-cyan-glow hover:underline" href={`/admin/users/${thread.owner.id}`}>{thread.owner.username}</Link> ({thread.owner.email})<Badge>{TICKET_CATEGORIES[t.category as keyof typeof TICKET_CATEGORIES]}</Badge><Badge tone="gold">{TICKET_STATUS[t.status as keyof typeof TICKET_STATUS]}</Badge>{thread.assignee ? `· отговорник: ${thread.assignee}` : '· без отговорник'}</span>}
        actions={
          <>
            {!thread.assignee && <ActionButton endpoint="/api/admin/action" action={{ type: 'ticketAssign', ticketId: id }}>Поеми</ActionButton>}
            {t.status !== 'closed' ? <ActionButton endpoint="/api/admin/action" action={{ type: 'ticketStatus', ticketId: id, status: 'closed' }}>Затвори</ActionButton> : <ActionButton endpoint="/api/admin/action" action={{ type: 'ticketStatus', ticketId: id, status: 'open' }}>Отвори отново</ActionButton>}
          </>
        }
      />
      <Thread messages={thread.messages} />
      <Card title="Отговор от поддръжката"><ReplyForm endpoint="/api/admin/action" action={{ type: 'ticketReply', ticketId: id }} /></Card>
    </div>
  );
}
