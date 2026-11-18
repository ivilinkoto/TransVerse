import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Card, PageHeader } from '@/components/ui';
import { CareersForm } from '@/components/careers/CareersForm';
import { CareersFaq, CareersGuide, CareersIntro } from '@/components/careers/CareersPitch';
import { dateTime } from '@/lib/format';
import { CAREER_ROLES, careerRole, STATUS_LABELS } from '@/lib/game/careers';
import { gameContext } from '@/server/game/context';
import { myApplication } from '@/server/game/careers';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Кариери в TransVerse') };
}

/** 1.3.1 „Екипът“: how applying works, the player's own application, the form with tips beside it, and questions. */
export default async function CareersPage() {
  await initLocale();
  const { db, user, features } = await gameContext();
  if (!features.careers) notFound();
  const mine = await myApplication(db, user.id);
  const locked = mine && (mine.status === 'interview' || mine.status === 'accepted');
  const roles = CAREER_ROLES.filter((r) => r.open).map((r) => ({ id: r.id, label: tx(r.label), emoji: r.emoji, hours: tx(r.hours), does: r.does.map((d) => tx(d)), fits: tx(r.fits) }));
  return (
    <div className="space-y-5">
      <PageHeader title={t('Кариери в TransVerse')} subtitle={t('Стани част от екипа, който развива TransVerse.')} />
      <Card><CareersIntro /></Card>
      {mine && (
        <Card title={t('Твоята кандидатура')}>
          <p className="text-sm" data-testid="careers-mine">{tx(careerRole(mine.role)?.label ?? mine.role)} · <span className="font-semibold text-cyan-glow">{tx(STATUS_LABELS[mine.status])}</span> · <span className="text-mist-400">{dateTime(new Date(mine.at))}</span></p>
          {!locked && <p className="mt-1 text-xs text-mist-400">{t('Можеш да я промениш по-долу — новата замества старата.')}</p>}
        </Card>
      )}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        {!locked ? (
          <Card title={mine ? t('Промени кандидатурата') : t('Кандидатствай')}>
            <CareersForm roles={roles} initial={mine ? { role: mine.role, about: mine.about, hours: mine.hours, contact: mine.contact, link: mine.link } : null} />
          </Card>
        ) : (
          <Card title={t('Кандидатствай')}><p className="text-sm text-mist-300">{t('Вече разговаряме с теб — ще се свържем.')}</p></Card>
        )}
        <Card title={t('Преди да пишеш')}><CareersGuide /></Card>
      </div>
      <Card title={t('Често задавани въпроси')}><CareersFaq /></Card>
    </div>
  );
}
