import Link from 'next/link';
import { Badge, Card, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { dateTime } from '@/lib/format';
import { REPORT_REASONS, type ReportReason } from '@/lib/game/moderation';
import { adminContext } from '@/server/admin-context';
import { reportList } from '@/server/game/moderation';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Доклади') };
}

const KIND = { player: 'Профил', channel: 'Общ чат', company: 'Чат на компания', dm: 'Лично съобщение', recruitment: 'Обява за набиране' } as const;
const RESOLUTION = { dismiss: 'отхвърлен', warn: 'предупреждение', delete_message: 'съобщението е изтрито', mute_h24: 'без чат 24 ч', mute_d7: 'без чат 7 дни' } as const;

export default async function AdminReports({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await initLocale();
  const { db, now } = await adminContext();
  const status = (await searchParams).status ?? 'open';
  const rows = await reportList(db, status === 'all' ? undefined : status);
  const act = (reportId: string, action: string) => ({ type: 'resolveReport', reportId, action });
  return (
    <div className="space-y-6">
      <PageHeader title={t('Доклади от играчи')} subtitle={t('Сигнали за съобщения и профили. Всяко решение се записва в одит дневника.')} />
      <nav className="flex flex-wrap gap-2" aria-label={t('Филтър')}>
        {[['open', t('Отворени')], ['resolved', t('Решени')], ['dismissed', t('Отхвърлени')], ['all', t('Всички')]].map(([k, label]) => (
          <Link key={k} href={`/admin/reports?status=${k}`} className={status === k ? 'btn-primary' : 'btn-ghost'}>{label}</Link>
        ))}
      </nav>
      {rows.length === 0 && <Card><p className="text-sm text-mist-400">{t('Няма доклади.')}</p></Card>}
      <div className="space-y-3">
        {rows.map(({ report: r, reporter, target, targetMutedUntil, targetBanned, priorReports }) => (
          <Card key={r.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Link href={`/admin/users/${r.targetUserId}`} className="font-semibold text-cyan-glow hover:underline">{target}</Link>
                  <Badge tone="orange">{REPORT_REASONS[r.reason as ReportReason] ?? r.reason}</Badge>
                  <Badge>{KIND[r.kind as keyof typeof KIND] ?? r.kind}</Badge>
                  {priorReports > 1 && <Badge tone="red">{t('{0} доклада общо', priorReports)}</Badge>}
                  {targetMutedUntil && targetMutedUntil > now && <Badge tone="violet">{t('без чат до {0}', dateTime(targetMutedUntil))}</Badge>}
                  {targetBanned && <Badge tone="red">{t('блокиран акаунт')}</Badge>}
                </div>
                <div className="mt-1 text-xs text-mist-400">{t('от {0} · {1}{2}', reporter, dateTime(r.createdAt), r.status !== 'open' && r.resolution ? ` · ${RESOLUTION[r.resolution as keyof typeof RESOLUTION] ?? r.resolution}` : '')}</div>
              </div>
            </div>
            {r.snippet && <blockquote className="mt-3 whitespace-pre-wrap break-words rounded-xl border-l-2 border-amber-sig bg-asphalt-850 px-3 py-2 text-sm">{tx(r.snippet)}</blockquote>}
            {r.details && <p className="mt-2 text-sm text-mist-300">„{tx(r.details)}“</p>}
            {r.status === 'open' && (
              <div className="mt-3 flex flex-wrap gap-2">
                {r.messageId && <ActionButton endpoint="/api/admin/action" action={act(r.id, 'delete_message')} className="btn-ghost px-3 py-1.5 text-xs">{t('Изтрий съобщението')}</ActionButton>}
                {r.postId && <ActionButton endpoint="/api/admin/action" action={act(r.id, 'delete_message')} className="btn-ghost px-3 py-1.5 text-xs">{t('Изтрий обявата')}</ActionButton>}
                <ActionButton endpoint="/api/admin/action" action={act(r.id, 'warn')} className="btn-ghost px-3 py-1.5 text-xs">{t('Предупреди')}</ActionButton>
                <ActionButton endpoint="/api/admin/action" action={act(r.id, 'mute_h24')} className="btn-ghost px-3 py-1.5 text-xs">{t('Без чат 24 ч')}</ActionButton>
                <ActionButton endpoint="/api/admin/action" action={act(r.id, 'mute_d7')} className="btn-danger px-3 py-1.5 text-xs" confirm={t('Без чат и лични съобщения за 7 дни?')}>{t('Без чат 7 дни')}</ActionButton>
                <ActionButton endpoint="/api/admin/action" action={act(r.id, 'dismiss')} className="btn-ghost px-3 py-1.5 text-xs text-mist-400">{t('Отхвърли')}</ActionButton>
                <Link href={`/admin/users/${r.targetUserId}`} className="btn-ghost px-3 py-1.5 text-xs">{t('Профил (блокиране) →')}</Link>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
