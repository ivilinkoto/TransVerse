import type { Metadata } from 'next';
import { Badge, Card, PageHeader } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { adminContext } from '@/server/admin-context';
import { playerJourney } from '@/server/admin-1142';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Пътят на играча') };
}
export const dynamic = 'force-dynamic';

const TONE = { money: 'green', trip: 'cyan', coins: 'gold', notice: 'neutral', ticket: 'violet', staff: 'orange' } as const;
const LABEL = { money: 'пари', trip: 'курс', coins: 'TC', notice: 'известие', ticket: 'запитване', staff: 'екип' } as const;

/** 1.1.4.2: a player's last steps in one timeline (for tickets like „изчезнаха ми парите“). */
export default async function AdminJourney({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await initLocale();
  const { db } = await adminContext();
  const { q = '' } = await searchParams;
  const j = q ? await playerJourney(db, q.slice(0, 60)) : null;
  return (
    <div className="space-y-6">
      <PageHeader title={t('Пътят на играча')} subtitle={t('Пари, курсове, ТрансКоин, известия, запитвания и действия на екипа — най-новото отгоре.')} />
      <form className="flex flex-wrap gap-2" action="/admin/journey">
        <input name="q" defaultValue={q} className="input max-w-xs" placeholder={t('Потребителско име или id')} aria-label={t('Играч')} />
        <button type="submit" className="btn-primary">{t('Покажи')}</button>
      </form>
      {j && !j.user && <p className="text-sm text-mist-400">{t('Няма такъв играч.')}</p>}
      {j?.user && (
        <Card title={t('{0} · {1} събития', j.user.username, j.items.length)}>
          <ol className="space-y-1 text-sm">
            {j.items.map((i, n) => (
              <li key={n} className="flex flex-wrap items-baseline gap-2">
                <span className="num w-36 shrink-0 text-xs text-mist-400">{dateTime(i.at)}</span>
                <Badge tone={TONE[i.kind]}>{tx(LABEL[i.kind])}</Badge>
                <span className="min-w-0 flex-1 break-words">{tx(i.text)}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
