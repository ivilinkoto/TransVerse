import Link from 'next/link';
import { Building2, UserSearch } from 'lucide-react';
import { notFound } from 'next/navigation';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { RecruitmentForm } from '@/components/game/RecruitmentForm';
import { PlayerName } from '@/components/game/PlayerName';
import { ReportPostButton } from '@/components/game/ReportPostButton';
import { dateTime } from '@/lib/format';
import { SPECIALIZATIONS, type Specialization } from '@/lib/game/specialization';
import { isStaff } from '@/server/auth/roles';
import { gameContext } from '@/server/game/context';
import { can, membershipOf } from '@/server/game/membership';
import { recruitmentBoard } from '@/server/game/recruitment';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Набиране') };
}

/** v1.6: the recruitment board — companies looking for drivers and drivers looking for a company. */
export default async function RecruitmentPage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.recruitment_board) notFound();
  const [board, membership] = await Promise.all([recruitmentBoard(db, now), membershipOf(db, user.id)]);
  const recruiter = !!membership && can(membership.rank, 'recruit');
  const staff = isStaff(user.role);
  const canRemove = (p: { userId: string; orgId: string | null }) => staff || p.userId === user.id || (recruiter && p.orgId === membership!.company.id);
  return (
    <div className="space-y-6">
      <PageHeader title={t('Набиране')} subtitle={t('Компании търсят шофьори, шофьори търсят компания. Една обява на компания и на шофьор, за една седмица.')} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t('Компании търсят шофьори')}>
          {recruiter && (
            <div className="mb-4">
              <RecruitmentForm kind="company" minLevel={membership!.company.minJoinLevel} placeholder={t('Какво предлага „{0}“ и кого търси (маршрути, вноска, график)…', membership!.company.name)} />
            </div>
          )}
          {board.companies.length ? (
            <ul className="space-y-3">
              {board.companies.map((p) => (
                <li key={p.id} className="rounded-xl border border-asphalt-700 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/game/companies/${p.orgId}`} className="font-semibold hover:text-cyan-glow">{tx(p.company)}{p.tag ? ` [${p.tag}]` : ''}</Link>
                    {p.specialization && p.specialization in SPECIALIZATIONS ? <Badge tone="violet">{tx(SPECIALIZATIONS[p.specialization as Specialization].label)}</Badge> : null}
                    <Badge tone="neutral">{t('ниво {0}+', p.minLevel)}</Badge>
                    {p.recruitment === 'open' ? <Badge tone="green">{t('отворена')}</Badge> : <Badge tone="blue">{t('с кандидатура')}</Badge>}
                  </div>
                  <p className="mt-2 whitespace-pre-line text-sm text-mist-200">{tx(p.text)}</p>
                  <div className="mt-2 flex items-center justify-between text-xs text-mist-400">
                    <span>{dateTime(p.createdAt)} · <PlayerName name={p.username} /></span>
                    <span className="flex items-center gap-3">
                      {p.userId !== user.id && <ReportPostButton postId={p.id} userId={p.userId} username={p.username} text={tx(p.text)} />}
                      {canRemove(p) && <ActionButton action={{ type: 'removeRecruitment', postId: p.id }} confirm={t('Да махнем ли обявата?')}>{t('Махни')}</ActionButton>}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={Building2} title={t('Няма обяви')}>{t('Компаниите още не търсят шофьори тук.')}</Empty>
          )}
        </Card>
        <Card title={t('Шофьори търсят компания')}>
          {!membership && (
            <div className="mb-4">
              <RecruitmentForm kind="driver" placeholder={t('Кой си, какво караш, кога играеш и каква компания търсиш…')} />
            </div>
          )}
          {board.drivers.length ? (
            <ul className="space-y-3">
              {board.drivers.map((p) => (
                <li key={p.id} className="rounded-xl border border-asphalt-700 p-3">
                  <div className="flex flex-wrap items-center gap-2"><PlayerName name={p.username} /><Badge tone="neutral">{t('ниво {0}', p.level)}</Badge></div>
                  <p className="mt-2 whitespace-pre-line text-sm text-mist-200">{tx(p.text)}</p>
                  <div className="mt-2 flex items-center justify-between text-xs text-mist-400">
                    <span>{dateTime(p.createdAt)}</span>
                    <span className="flex items-center gap-3">
                      {p.userId !== user.id && <ReportPostButton postId={p.id} userId={p.userId} username={p.username} text={tx(p.text)} />}
                      {canRemove(p) && <ActionButton action={{ type: 'removeRecruitment', postId: p.id }} confirm={t('Да махнем ли обявата?')}>{t('Махни')}</ActionButton>}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={UserSearch} title={t('Няма обяви')}>{t('Никой не търси компания в момента.')}</Empty>
          )}
        </Card>
      </div>
    </div>
  );
}
