import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui';
import { SkillsTree } from '@/components/game/SkillsTree';
import { SKILL_RULES } from '@/lib/game/skills';
import { gameContext } from '@/server/game/context';
import { skillsView } from '@/server/game/skills';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Умения') };
}


/** 1.3 „Умения на шофьора“: three branches, a point per level, small bonuses on every delivery. */
export default async function SkillsPage() {
  await initLocale();
  const { db, user, features } = await gameContext();
  if (!features.driver_skills) notFound();
  const v = await skillsView(db, user.id);
  return (
    <div className="space-y-4">
      <PageHeader title={t('Умения на шофьора')} subtitle={t('Твоят опит зад волана — по точка за всяко ниво.')} help={t('Всяко умение има {0} нива. Ефектът се плаща при всяка доставка на компанията ти като ред „Умения на шофьора“.', SKILL_RULES.maxRank)} />
      <SkillsTree v={v} />
    </div>
  );
}
