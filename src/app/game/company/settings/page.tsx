import { redirect } from 'next/navigation';
import { SettingsForm } from '@/components/company/forms';
import { Card } from '@/components/ui';
import { COMPANY_LIMITS, RECRUITMENT } from '@/lib/game/company';
import { gameContext } from '@/server/game/context';
import { can, companyHub } from '@/server/game/membership';

export const metadata = { title: 'Настройки на компанията' };

export default async function CompanySettingsPage() {
  const { db, user } = await gameContext();
  const hub = await companyHub(db, user.id);
  if (!hub) redirect('/game/company');
  if (!can(hub.rank, 'manage_settings')) return <Card><p className="text-sm text-mist-400">Длъжността ви няма право да променя настройките.</p></Card>;
  const c = hub.company;
  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <Card title="Набиране и вноски">
        <SettingsForm
          initial={{ recruitment: c.recruitment, minJoinLevel: c.minJoinLevel, contributionPct: Math.round(c.contributionRate * 100) }}
          recruitmentOptions={Object.entries(RECRUITMENT).map(([value, label]) => ({ value, label }))}
          maxRatePct={Math.round(COMPANY_LIMITS.contributionMax * 100)}
        />
      </Card>
      <Card title="Как работят вноските">
        <p className="text-sm text-mist-300">
          След всеки курс на член съответният процент от възнаграждението отива в касата на компанията. С тези пари се купуват подобренията, които дават бонуси на всички членове. Висока вноска пълни касата бързо, но може да отблъсне шофьорите — максимумът е {Math.round(COMPANY_LIMITS.contributionMax * 100)}%.
        </p>
      </Card>
    </div>
  );
}
