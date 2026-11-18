import Link from 'next/link';
import type { Metadata } from 'next';
import { Card, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { date, dateTime } from '@/lib/format';
import { APPLICATION_STATUSES, careerRole, STATUS_LABELS, type ApplicationStatus } from '@/lib/game/careers';
import { adminContext } from '@/server/admin-context';
import { listApplications } from '@/server/game/careers';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Кандидатури') };
}
export const dynamic = 'force-dynamic';

const NEXT: Record<ApplicationStatus, ApplicationStatus[]> = { new: ['reviewing', 'interview', 'rejected'], reviewing: ['interview', 'rejected'], interview: ['accepted', 'rejected'], accepted: [], rejected: ['reviewing'] };

/** 1.3.1 „Екипът“: the players who applied to the team, with their level and activity; the admins decide. */
export default async function AdminCareers({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await initLocale();
  const { db } = await adminContext({ admin: true });
  const q = (await searchParams).status;
  const status = APPLICATION_STATUSES.includes(q as ApplicationStatus) ? (q as ApplicationStatus) : undefined;
  const apps = await listApplications(db, status);
  return (
    <div className="space-y-5">
      <PageHeader title={t('Кандидатури')} subtitle={t('Играчи, които искат да са в екипа. Само администраторите виждат тази страница.')} />
      <nav className="flex flex-wrap gap-2 text-sm" aria-label={t('Статус')}>
        <Link href="/admin/careers" className={`rounded-lg px-3 py-1.5 ${!status ? 'bg-cyan-glow text-asphalt-950' : 'bg-asphalt-800'}`}>{t('Всички')}</Link>
        {APPLICATION_STATUSES.map((s) => <Link key={s} href={`/admin/careers?status=${s}`} className={`rounded-lg px-3 py-1.5 ${status === s ? 'bg-cyan-glow text-asphalt-950' : 'bg-asphalt-800'}`}>{tx(STATUS_LABELS[s])}</Link>)}
      </nav>
      {apps.length === 0 ? <p className="text-sm text-mist-400">{t('Няма кандидатури.')}</p> : apps.map((a) => (
        <Card key={a.userId} title={`${careerRole(a.role)?.emoji ?? ''} ${tx(careerRole(a.role)?.label ?? a.role)} · ${a.player?.username ?? '—'}`}>
          <div className="space-y-2 text-sm" data-testid="career-app">
            <p className="text-xs text-mist-400">
              {t('Статус')}: <span className="font-semibold text-cyan-glow">{tx(STATUS_LABELS[a.status])}</span> · {t('Изпратена')} {dateTime(new Date(a.at))}
              {a.player && <> · {t('ниво {0}', a.player.level)} · {t('от {0}', date(a.player.createdAt))} · {t('последно в играта {0}', a.player.lastSeenAt ? dateTime(a.player.lastSeenAt) : '—')}</>}
            </p>
            <p className="whitespace-pre-wrap text-mist-200">{a.about}</p>
            <p className="text-xs text-mist-300">{t('{0} ч седмично', a.hours)} · {t('Контакт')}: <span className="select-all">{a.contact}</span>{a.link && <> · <a href={a.link} target="_blank" rel="noreferrer noopener" className="text-cyan-glow hover:underline">{t('Портфолио')}</a></>}</p>
            {a.player && <Link href={`/admin/users/${a.userId}`} className="text-xs text-cyan-glow hover:underline">{t('Профил на играча →')}</Link>}
            {NEXT[a.status].length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {NEXT[a.status].map((s) => (
                  <ActionButton key={s} endpoint="/api/admin/action" action={{ type: 'careerStatus', userId: a.userId, status: s }} className={s === 'rejected' ? 'btn-ghost px-3 py-1 text-xs' : 'btn-primary px-3 py-1 text-xs'} confirm={s === 'accepted' || s === 'rejected' ? t('Играчът ще получи известие. Сигурен ли си?') : undefined}>
                    {tx(STATUS_LABELS[s])}
                  </ActionButton>
                ))}
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
