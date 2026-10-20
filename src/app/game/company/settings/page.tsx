import { redirect } from 'next/navigation';
import { SettingsForm, TransferOwnershipForm } from '@/components/company/forms';
import { ActionButton } from '@/components/ui/ActionButton';
import { money } from '@/lib/format';
import { Card } from '@/components/ui';
import { COMPANY_LIMITS, RECRUITMENT } from '@/lib/game/company';
import { gameContext } from '@/server/game/context';
import { discordConfig } from '@/server/discord/config';
import { can, companyHub, companyMembersView } from '@/server/game/membership';

export const metadata = { title: 'Настройки на компанията' };

export default async function CompanySettingsPage() {
  const { db, user, features } = await gameContext();
  const hub = await companyHub(db, user.id);
  if (!hub) redirect('/game/company');
  if (!can(hub.rank, 'manage_settings')) return <Card><p className="text-sm text-mist-400">Длъжността ви няма право да променя настройките.</p></Card>;
  const c = hub.company;
  const others = hub.rank.isOwner ? (await companyMembersView(db, c.id)).filter((m) => m.userId !== user.id) : [];
  return (
    <div className="space-y-6">
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
      {features.discord_bot && discordConfig().bot && (
        <Card title="Канал в Discord">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="max-w-2xl text-mist-300">
              {c.discordChannel
                ? `Компанията има частен канал в Discord сървъра на TransVerse${c.discordChannelId ? '' : ' (създава се…)'}. Виждат го само членовете със свързан Discord, а съобщенията вървят и в двете посоки с чата в играта.`
                : 'Частен канал за компанията в Discord сървъра на TransVerse: виждат го само членовете със свързан Discord (ботът сам добавя и маха хора), а съобщенията вървят и в двете посоки с чата в играта.'}
            </p>
            <ActionButton action={{ type: 'companyDiscord', on: !c.discordChannel }} className={c.discordChannel ? 'btn-ghost' : 'btn-primary'} confirm={c.discordChannel ? 'Да махнем ли канала на компанията от Discord?' : undefined}>{c.discordChannel ? 'Махни канала' : 'Създай канал'}</ActionButton>
          </div>
        </Card>
      )}
      {hub.rank.isOwner && (
        <section id="ownership" className="grid scroll-mt-6 gap-6 lg:grid-cols-[1.2fr_1fr]">
          <Card title="Предаване на собствеността">
            <p className="mb-4 text-sm text-mist-300">
              Ако искате да напуснете компанията, първо трябва да предадете собствеността на друг член. Новият собственик получава всички права и лиценз за собствен автопарк (и депо в седалището, ако няма). Касата остава на компанията.
            </p>
            <TransferOwnershipForm members={others.map((m) => ({ userId: m.userId, label: `${m.username} · ${m.rank.name} · ниво ${m.level}` }))} />
          </Card>
          <Card title="Закриване на компанията">
            {others.length ? (
              <p className="text-sm text-mist-400">Компания с членове не може да се закрие — предайте собствеността на някой от тях.</p>
            ) : (
              <>
                <p className="mb-4 text-sm text-mist-300">Вие сте единственият член. При закриване компанията, длъжностите и профилът се изтриват, а остатъкът в касата ({money(c.treasuryCents)}) се превежда в личния ви баланс.</p>
                <ActionButton action={{ type: 'dissolveCompany' }} className="btn-danger" confirm="Компанията ще бъде изтрита окончателно. Продължаване?">Закрий компанията</ActionButton>
              </>
            )}
          </Card>
        </section>
      )}
    </div>
  );
}
