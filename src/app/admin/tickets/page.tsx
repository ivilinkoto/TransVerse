import Link from 'next/link';
import { Badge, Card, PageHeader, Table } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { adminContext } from '@/server/admin-context';
import { staffTicketList, TICKET_CATEGORIES, TICKET_STATUS } from '@/server/game/support';

export const metadata = { title: 'Поддръжка' };
const TONE = { open: 'gold', answered: 'green', closed: 'neutral' } as const;

export default async function AdminTickets({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { db } = await adminContext();
  const status = (await searchParams).status ?? 'open';
  const rows = await staffTicketList(db, status === 'all' ? undefined : status);
  return (
    <div className="space-y-6">
      <PageHeader title="Запитвания от играчи" />
      <nav className="flex flex-wrap gap-2" aria-label="Филтър по статус">
        {[['open', 'Отворени'], ['answered', 'Отговорени'], ['closed', 'Затворени'], ['all', 'Всички']].map(([k, label]) => (
          <Link key={k} href={`/admin/tickets?status=${k}`} className={status === k ? 'btn-primary' : 'btn-ghost'}>{label}</Link>
        ))}
      </nav>
      <Card>
        <Table head={['Тема', 'Играч', 'Категория', 'Статус', 'Обновено']}>
          {rows.map(({ ticket, username }) => (
            <tr key={ticket.id}>
              <td className="px-3 py-2"><Link href={`/admin/tickets/${ticket.id}`} className="font-semibold text-cyan-glow hover:underline">{ticket.subject}</Link></td>
              <td className="px-3 py-2">{username}</td>
              <td className="px-3 py-2 text-mist-300">{TICKET_CATEGORIES[ticket.category as keyof typeof TICKET_CATEGORIES]}</td>
              <td className="px-3 py-2"><Badge tone={TONE[ticket.status as keyof typeof TONE] ?? 'neutral'}>{TICKET_STATUS[ticket.status as keyof typeof TICKET_STATUS]}</Badge></td>
              <td className="px-3 py-2 text-mist-400">{dateTime(ticket.updatedAt)}</td>
            </tr>
          ))}
        </Table>
        {rows.length === 0 && <p className="mt-3 text-sm text-mist-400">Няма запитвания.</p>}
      </Card>
    </div>
  );
}
