import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ReplyForm } from '@/components/support/ReplyForm';
import { Thread } from '@/components/support/Thread';
import { Badge, Card, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { gameContext } from '@/server/game/context';
import { GameError } from '@/server/game/errors';
import { TICKET_CATEGORIES, TICKET_STATUS, ticketThread } from '@/server/game/support';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Запитване') };
}

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  await initLocale();
  const { id } = await params;
  const { db, user } = await gameContext();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const thread = await ticketThread(db, { ...user, role: 'player' }, id).catch((e) => {
    if (e instanceof GameError) notFound();
    throw e;
  });
  if (thread.ticket.userId !== user.id) notFound();
  const closed = thread.ticket.status === 'closed';
  return (
    <div className="space-y-6">
      <PageHeader
        title={tx(thread.ticket.subject)}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2"><Badge>{tx(TICKET_CATEGORIES[thread.ticket.category as keyof typeof TICKET_CATEGORIES])}</Badge><Badge tone={closed ? 'neutral' : thread.ticket.status === 'answered' ? 'green' : 'gold'}>{tx(TICKET_STATUS[thread.ticket.status as keyof typeof TICKET_STATUS])}</Badge><Link href="/game/support" className="text-cyan-glow hover:underline">{t('← Всички запитвания')}</Link></span>}
        actions={!closed ? <ActionButton action={{ type: 'closeTicket', ticketId: id }} confirm={t('Затваряне на запитването?')}>{t('Затвори')}</ActionButton> : undefined}
      />
      <Thread messages={thread.messages} />
      <Card title={closed ? t('Запитването е затворено') : t('Отговор')}>
        {closed ? <p className="text-sm text-mist-400">{t('Ако проблемът продължава, отворете ново запитване.')}</p> : <ReplyForm endpoint="/api/game/action" action={{ type: 'replyTicket', ticketId: id }} />}
      </Card>
    </div>
  );
}
