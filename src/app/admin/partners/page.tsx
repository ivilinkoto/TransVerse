import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { dateTime } from '@/lib/format';
import { partnerKindLabel } from '@/lib/game/partners';
import { adminContext } from '@/server/admin-context';
import { INQUIRY_STATUSES, partnerInquiryList } from '@/server/partners';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import { Handshake } from 'lucide-react';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Партньори') };
}

const STATUS_LABEL: Record<string, string> = { new: 'Нови', answered: 'Отговорени', archived: 'Архив', all: 'Всички' };

/** 1.2.3.1: the messages from the „За партньори“ page (administrators only). */
export default async function AdminPartnersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await initLocale();
  const { db } = await adminContext({ admin: true });
  const sp = await searchParams;
  const status = ([...INQUIRY_STATUSES, 'all'] as const).find((s) => s === sp.status) ?? 'new';
  const rows = await partnerInquiryList(db, status);
  return (
    <div className="space-y-6">
      <PageHeader title={t('Партньори')} subtitle={t('Запитвания от страницата „За партньори“ — спонсори, създатели, преса и бизнес.')} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(['new', 'answered', 'archived', 'all'] as const).map((s) => (
          <Link key={s} href={`/admin/partners?status=${s}`} className={`rounded-lg border px-3 py-1.5 ${s === status ? 'border-prestige bg-prestige/15 text-white' : 'border-asphalt-700 text-mist-300'}`}>{tx(STATUS_LABEL[s]!)}</Link>
        ))}
        <a href="/partners" target="_blank" className="ml-auto text-cyan-glow hover:underline">{t('Публичната страница →')}</a>
      </div>
      {rows.length === 0 ? (
        <Empty icon={Handshake} title={t('Няма запитвания тук')} />
      ) : (
        <div className="space-y-3" data-testid="partner-inquiries">
          {rows.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={r.kind === 'sponsor' || r.kind === 'business' ? 'gold' : 'cyan'}>{tx(partnerKindLabel(r.kind))}</Badge>
                <span className="font-semibold">{r.name}</span>
                {r.organization && <span className="text-mist-300">· {r.organization}</span>}
                <span className="ml-auto text-xs text-mist-400">{dateTime(r.createdAt)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-3 text-sm">
                <a href={`mailto:${r.email}?subject=${encodeURIComponent('TransVerse')}`} className="text-cyan-glow hover:underline">{r.email}</a>
                {r.link && <a href={r.link} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-cyan-glow hover:underline">{r.link}</a>}
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm text-mist-200">{r.message}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {r.status !== 'answered' && <ActionButton endpoint="/api/admin/action" action={{ type: 'partnerInquiry', id: r.id, status: 'answered' }} className="btn-primary px-3 py-1.5 text-xs">{t('Отговорено')}</ActionButton>}
                {r.status !== 'archived' && <ActionButton endpoint="/api/admin/action" action={{ type: 'partnerInquiry', id: r.id, status: 'archived' }} className="btn-ghost px-3 py-1.5 text-xs">{t('Архивирай')}</ActionButton>}
                {r.status !== 'new' && <ActionButton endpoint="/api/admin/action" action={{ type: 'partnerInquiry', id: r.id, status: 'new' }} className="btn-ghost px-3 py-1.5 text-xs">{t('Върни в нови')}</ActionButton>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
