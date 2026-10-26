import { redirect } from 'next/navigation';
import { SettingsForm, TransferOwnershipForm } from '@/components/company/forms';
import { ActionButton } from '@/components/ui/ActionButton';
import { money } from '@/lib/format';
import { Card } from '@/components/ui';
import { COMPANY_LIMITS, RECRUITMENT } from '@/lib/game/company';
import { SPECIALIZATION, SPECIALIZATIONS, type Specialization } from '@/lib/game/specialization';
import { gameContext } from '@/server/game/context';
import { discordConfig } from '@/server/discord/config';
import { can, companyHub, companyMembersView } from '@/server/game/membership';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Настройки на компанията') };
}

export default async function CompanySettingsPage() {
  await initLocale();
  const { db, user, features } = await gameContext();
  const hub = await companyHub(db, user.id);
  if (!hub) redirect('/game/company');
  if (!can(hub.rank, 'manage_settings')) return <Card><p className="text-sm text-mist-400">{t('Длъжността ви няма право да променя настройките.')}</p></Card>;
  const c = hub.company;
  const others = hub.rank.isOwner ? (await companyMembersView(db, c.id)).filter((m) => m.userId !== user.id) : [];
  return (
    <div className="space-y-6">
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <Card title={t('Набиране и вноски')}>
        <SettingsForm
          initial={{ recruitment: c.recruitment, minJoinLevel: c.minJoinLevel, contributionPct: Math.round(c.contributionRate * 100) }}
          recruitmentOptions={Object.entries(RECRUITMENT).map(([value, label]) => ({ value, label }))}
          maxRatePct={Math.round(COMPANY_LIMITS.contributionMax * 100)}
        />
      </Card>
      <Card title={t('Как работят вноските')}>
        <p className="text-sm text-mist-300">
          {t('След всеки курс на член съответният процент от възнаграждението отива в касата на компанията. С тези пари се купуват подобренията, които дават бонуси на всички членове. Висока вноска пълни касата бързо, но може да отблъсне шофьорите — максимумът е {0}%.', Math.round(COMPANY_LIMITS.contributionMax * 100))}
        </p>
      </Card>
    </div>
      {features.specializations && (
        <Card title={t('Специализация')}>
          <p className="text-sm text-mist-300">
            {t('С какво е известна компанията: членовете получават +{0} % за товарите от този вид. Сменя се веднъж на {1} дни.', Math.round(SPECIALIZATION.bonusShare * 100), SPECIALIZATION.changeDays)}
            {c.specialization && c.specialization in SPECIALIZATIONS ? <>{' '}{t('Сега:')}{' '}<span className="font-semibold text-mist-100">{tx(SPECIALIZATIONS[c.specialization as Specialization].label)}</span>.</> : t(' Сега компанията няма специализация.')}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(Object.keys(SPECIALIZATIONS) as Specialization[]).map((k) => (
              <ActionButton key={k} action={{ type: 'setSpecialization', specialization: k }} className={c.specialization === k ? 'btn-primary' : 'btn-ghost'} disabled={c.specialization === k} confirm={t('Специализация „{0}“? Следващата смяна — след {1} дни.', SPECIALIZATIONS[k].label, SPECIALIZATION.changeDays)}>
                {tx(SPECIALIZATIONS[k].label)}
              </ActionButton>
            ))}
          </div>
        </Card>
      )}
      {features.discord_bot && discordConfig().bot && (
        <Card title={t('Канал в Discord')}>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="max-w-2xl text-mist-300">
              {c.discordChannel
                ? t('Компанията има частен канал в Discord сървъра на TransVerse{0}. Виждат го само членовете със свързан Discord, а съобщенията вървят и в двете посоки с чата в играта.', c.discordChannelId ? '' : t(' (създава се…)'))
                : t('Частен канал за компанията в Discord сървъра на TransVerse: виждат го само членовете със свързан Discord (ботът сам добавя и маха хора), а съобщенията вървят и в двете посоки с чата в играта.')}
            </p>
            <ActionButton action={{ type: 'companyDiscord', on: !c.discordChannel }} className={c.discordChannel ? 'btn-ghost' : 'btn-primary'} confirm={c.discordChannel ? t('Да махнем ли канала на компанията от Discord?') : undefined}>{c.discordChannel ? t('Махни канала') : t('Създай канал')}</ActionButton>
          </div>
        </Card>
      )}
      {hub.rank.isOwner && (
        <section id="ownership" className="grid scroll-mt-6 gap-6 lg:grid-cols-[1.2fr_1fr]">
          <Card title={t('Предаване на собствеността')}>
            <p className="mb-4 text-sm text-mist-300">
              {t('Ако искате да напуснете компанията, първо трябва да предадете собствеността на друг член. Новият собственик получава всички права и лиценз за собствен автопарк (и депо в седалището, ако няма). Касата остава на компанията.')}
            </p>
            <TransferOwnershipForm members={others.map((m) => ({ userId: m.userId, label: t('{0} · {1} · ниво {2}', m.username, m.rank.name, m.level) }))} />
          </Card>
          <Card title={t('Закриване на компанията')}>
            {others.length ? (
              <p className="text-sm text-mist-400">{t('Компания с членове не може да се закрие — предайте собствеността на някой от тях.')}</p>
            ) : (
              <>
                <p className="mb-4 text-sm text-mist-300">{t('Вие сте единственият член. При закриване компанията, длъжностите и профилът се изтриват, а остатъкът в касата ({0}) се превежда в личния ви баланс.', money(c.treasuryCents))}</p>
                <ActionButton action={{ type: 'dissolveCompany' }} className="btn-danger" confirm={t('Компанията ще бъде изтрита окончателно. Продължаване?')}>{t('Закрий компанията')}</ActionButton>
              </>
            )}
          </Card>
        </section>
      )}
    </div>
  );
}
