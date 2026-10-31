import Link from 'next/link';
import { Badge, Card, PageHeader, Table } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { adminContext } from '@/server/admin-context';
import { supportTemplatesList } from '@/server/admin-1142';
import { FormAction } from '@/components/ui/FormAction';
import { ActionButton } from '@/components/ui/ActionButton';
import { staffTicketList, TICKET_CATEGORIES, TICKET_STATUS } from '@/server/game/support';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Поддръжка') };
}
const TONE = { open: 'gold', answered: 'green', closed: 'neutral' } as const;

export default async function AdminTickets({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await initLocale();
  const { db } = await adminContext();
  const status = (await searchParams).status ?? 'open';
  const rows = await staffTicketList(db, status === 'all' ? undefined : status);
  const templates = await supportTemplatesList(db);
  return (
    <div className="space-y-6">
      <PageHeader title={t('Запитвания от играчи')} />
      {/* 1.1.4.2: reply templates (copied on each ticket's page). */}
      <Card title={t('Шаблони за отговор ({0})', templates.length)}>
        <FormAction endpoint="/api/admin/action" action={{ type: 'supportTemplate' }} fields={[{ name: 'title', label: t('Заглавие'), type: 'text', defaultValue: '' }, { name: 'body', label: t('Текст'), type: 'text', defaultValue: '' }]} submit={t('Добави')} />
        {templates.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {templates.map((x) => <li key={x.id} className="flex items-center justify-between gap-2"><span className="min-w-0 truncate"><span className="font-semibold">{x.title}</span> — <span className="text-mist-400">{x.body}</span></span><ActionButton endpoint="/api/admin/action" action={{ type: 'deleteSupportTemplate', id: x.id }} className="btn-ghost px-2 py-0.5 text-[11px]">✕</ActionButton></li>)}
          </ul>
        )}
      </Card>
      <nav className="flex flex-wrap gap-2" aria-label={t('Филтър по статус')}>
        {[['open', t('Отворени')], ['answered', t('Отговорени')], ['closed', t('Затворени')], ['all', t('Всички')]].map(([k, label]) => (
          <Link key={k} href={`/admin/tickets?status=${k}`} className={status === k ? 'btn-primary' : 'btn-ghost'}>{label}</Link>
        ))}
      </nav>
      <Card>
        <Table head={[t('Тема'), t('Играч'), t('Категория'), t('Статус'), t('Обновено')]}>
          {rows.map(({ ticket, username }) => (
            <tr key={ticket.id}>
              <td className="px-3 py-2"><Link href={`/admin/tickets/${ticket.id}`} className="font-semibold text-cyan-glow hover:underline">{tx(ticket.subject)}</Link></td>
              <td className="px-3 py-2">{username}</td>
              <td className="px-3 py-2 text-mist-300">{tx(TICKET_CATEGORIES[ticket.category as keyof typeof TICKET_CATEGORIES])}</td>
              <td className="px-3 py-2"><Badge tone={TONE[ticket.status as keyof typeof TONE] ?? 'neutral'}>{tx(TICKET_STATUS[ticket.status as keyof typeof TICKET_STATUS])}</Badge></td>
              <td className="px-3 py-2 text-mist-400">{dateTime(ticket.updatedAt)}</td>
            </tr>
          ))}
        </Table>
        {rows.length === 0 && <p className="mt-3 text-sm text-mist-400">{t('Няма запитвания.')}</p>}
      </Card>
    </div>
  );
}
