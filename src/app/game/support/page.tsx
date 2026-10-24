import { LifeBuoy } from 'lucide-react';
import Link from 'next/link';
import { NewTicketForm } from '@/components/support/NewTicketForm';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { gameContext } from '@/server/game/context';
import { myTickets, TICKET_CATEGORIES, TICKET_STATUS } from '@/server/game/support';
import { t as tr, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: tr('Поддръжка') };
}

const TONE = { open: 'gold', answered: 'green', closed: 'neutral' } as const;

export default async function SupportPage() {
  await initLocale();
  const { db, user } = await gameContext();
  const tickets = await myTickets(db, user.id);
  return (
    <div className="space-y-6">
      <PageHeader title={tr('Техническа поддръжка')} subtitle={tr('Пишете ни за проблеми с профила, грешки в играта или въпроси. Отговорът идва тук и като известие.')} />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <Card title={tr('Ново запитване')}><NewTicketForm categories={TICKET_CATEGORIES} /></Card>
        <Card title={tr('Моите запитвания')}>
          {tickets.length === 0 ? <Empty icon={LifeBuoy} title={tr('Нямате запитвания')} /> : (
            <ul className="divide-y divide-asphalt-800">
              {tickets.map((t) => (
                <li key={t.id}>
                  <Link href={`/game/support/${t.id}`} className="flex items-center justify-between gap-3 py-3 hover:text-white">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{tx(t.subject)}</span>
                      <span className="text-xs text-mist-400">{tx(TICKET_CATEGORIES[t.category as keyof typeof TICKET_CATEGORIES])} · {dateTime(t.updatedAt)}</span>
                    </span>
                    <Badge tone={TONE[t.status as keyof typeof TONE] ?? 'neutral'}>{tx(TICKET_STATUS[t.status as keyof typeof TICKET_STATUS])}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
