import { desc, eq } from 'drizzle-orm';
import { Building2, CalendarDays, CheckCircle2, Circle, Coins, Gift, MapPin, Route, ScrollText, Star, Timer, Truck, Users } from 'lucide-react';
import Link from 'next/link';
import { ActionButton } from '@/components/ui/ActionButton';
import { companyXpForLevel, COMPANY_UNLOCKS, memberBonuses, type UpgradeLevels } from '@/lib/game/company';
import { companyHub, myApplications } from '@/server/game/membership';
import { FoundCompanyForm } from '@/components/game/FoundCompanyForm';
import { TutorialVisit } from '@/components/game/TutorialVisit';
import { Badge, Card, Meter, PageHeader, Stat } from '@/components/ui';
import { ECONOMY } from '@/lib/game/economy';
import { foundingCheck, headquarterOptions } from '@/server/game/company';
import { tutorialPending } from '@/server/game/tutorial-flags';
import { date, dateTime, int, km, money } from '@/lib/format';
import { activity } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';
import { companyStats } from '@/server/game/progression';
import { fleetView, netWorthCents } from '@/server/game/queries';

export const metadata = { title: 'Транспортна компания' };

const ACTION_LABEL: Record<string, string> = {
  registered: 'Регистрация',
  registered_independent: 'Регистрация като самостоятелен шофьор',
  company_founded: 'Основана компания',
  vehicle_rented: 'Нает камион',
  rental_returned: 'Върнат нает камион',
  company_joined: 'Присъединяване към компания',
  company_applied: 'Кандидатура към компания',
  company_left: 'Напускане на компания',
  company_application_accepted: 'Одобрена кандидатура',
  company_member_removed: 'Изключен член',
  company_profile_updated: 'Редактиран профил на компанията',
  company_settings_updated: 'Променени настройки на компанията',
  company_upgrade: 'Развитие на компанията',
  company_asset_uploaded: 'Качено изображение на компанията',
  password_changed: 'Сменена парола', login: 'Вход', company_created: 'Създадена компания', contract_accepted: 'Приета поръчка', vehicle_bought: 'Купено превозно средство',
  trailer_bought: 'Купено ремарке', vehicle_sold: 'Продадено превозно средство', driver_hired: 'Нает шофьор', driver_fired: 'Освободен шофьор',
};

export default async function CompanyPage() {
  const { db, user, company, hq } = await gameContext();
  const visitPending = await tutorialPending(db, user.id, 'company_goal');
  const hub = await companyHub(db, user.id);
  if (hub && hub.company.id !== company.id) return <MemberOverview hub={hub} />;
  if (company.kind !== 'company') {
    const [check, cities, applications] = await Promise.all([foundingCheck(db, user.id), headquarterOptions(db), myApplications(db, user.id)]);
    const rows = [
      { label: `Ниво ${check.level.required}`, ok: check.level.ok, value: `сега ${check.level.current}`, share: check.level.current / check.level.required },
      { label: `${check.deliveries.required} изпълнени доставки`, ok: check.deliveries.ok, value: `${check.deliveries.current} / ${check.deliveries.required}`, share: check.deliveries.current / check.deliveries.required },
      { label: `Такса за регистрация ${money(check.funds.required)}`, ok: check.funds.ok, value: `налични ${money(check.funds.current)}`, share: Math.max(0, check.funds.current) / check.funds.required },
    ];
    return (
      <div className="space-y-6">
        <TutorialVisit step="company_goal" pending={visitPending} />
        <PageHeader title="Транспортна компания" subtitle="Засега работиш като самостоятелен шофьор с нает камион. Присъедини се към компания на друг играч или основи своя." />
        <Card title="Присъедини се към компания">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="max-w-2xl text-sm text-mist-300">
              Не искаш собствена фирма? Влез в екипа на друг играч. Запазваш камиона и парите си, а компанията ти дава бонуси към възнаграждението, по-евтин наем и повече опит — според това колко е развита.
            </p>
            <Link href="/game/companies" className="btn-gold"><Users className="h-4 w-4" />Разгледай компаниите</Link>
          </div>
          {applications.length > 0 && (
            <ul className="mt-4 space-y-2 text-sm">
              {applications.map((a) => (
                <li key={a.application.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-asphalt-700 px-3 py-2">
                  <span>Кандидатура към <Link className="font-semibold text-cyan-glow hover:underline" href={`/game/companies/${a.application.companyId}`}>„{a.company}“</Link> · чака одобрение</span>
                  <ActionButton action={{ type: 'withdrawApplication', applicationId: a.application.id }} className="btn-ghost px-3 py-1.5 text-sm">Оттегли</ActionButton>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <Card title="Изисквания за основаване">
            <ul className="space-y-4">
              {rows.map((r) => (
                <li key={r.label}>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2">{r.ok ? <CheckCircle2 className="h-4 w-4 text-profit" /> : <Circle className="h-4 w-4 text-mist-400" />}{r.label}</span>
                    <span className="num text-mist-400">{r.value}</span>
                  </div>
                  <Meter value={Math.min(1, r.share) * 100} tone={r.ok ? 'auto' : 'gold'} className="mt-1.5" />
                </li>
              ))}
            </ul>
            <div className="mt-6 rounded-xl border border-asphalt-700 bg-asphalt-850 p-4 text-sm text-mist-300">
              <p className="font-semibold text-mist-100">Какво получаваш с компания</p>
              <ul className="mt-2 list-inside list-disc space-y-1">
                <li>Седалище и депо с {ECONOMY.depotSlotsDefault} места</li>
                <li>Покупка и наем на още превозни средства и ремаркета</li>
                <li>Наемане на шофьори — повече курсове едновременно</li>
                <li>Нови депа в реални градове из региона</li>
                <li>Други играчи могат да се присъединят към теб — с длъжности, права и общо развитие</li>
              </ul>
              <p className="mt-3 flex items-center gap-2 text-xs text-mist-400"><Truck className="h-3.5 w-3.5" />Наетият ти камион остава и след основаването.</p>
            </div>
          </Card>
          <Card title="Регистрация на компания">
            <FoundCompanyForm cities={cities.map((c) => ({ id: c.id, nameBg: c.nameBg }))} defaultCityId={company.hqCityId} ready={check.ok} feeLabel={money(ECONOMY.foundingFeeCents)} />
          </Card>
        </div>
      </div>
    );
  }
  const [stats, worth, fleet, history] = await Promise.all([
    companyStats(db, company.id),
    netWorthCents(db, company.id),
    fleetView(db, company.id),
    db.select().from(activity).where(eq(activity.userId, user.id)).orderBy(desc(activity.id)).limit(30),
  ]);
  const fleetValue = fleet.vehicles.reduce((s, v) => s + v.resaleCents, 0) + fleet.trailers.reduce((s, t) => s + t.resaleCents, 0);
  const onTime = stats.deliveries ? (stats.onTimeDeliveries / stats.deliveries) * 100 : 0;
  return (
    <div className="space-y-6">
      <TutorialVisit step="company_goal" pending={visitPending} />
      <p className="flex flex-wrap items-center gap-3 text-sm text-mist-400"><span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />Седалище {hq.nameBg}</span><span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />Основана {date(company.foundedAt ?? company.createdAt)}</span></p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Стойност на компанията" value={money(worth)} tone="gold" icon={Building2} hint={`Пари ${money(company.balanceCents)} · техника ${money(fleetValue)}`} />
        <Stat label="Доставки" value={int(stats.deliveries)} tone="cyan" icon={Route} hint={`${int(stats.countriesServed)} държави обслужени`} />
        <Stat label="Точност" value={`${onTime.toFixed(0)}%`} tone="profit" icon={Timer} hint={`${stats.onTimeDeliveries} навреме`} />
        <Stat label="Репутация" value={company.reputation.toFixed(1)} tone="prestige" icon={Star} hint={`${km(stats.totalKm)} изминати`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Структура">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div><dt className="label">Превозни средства</dt><dd className="num mt-1 text-xl font-bold">{stats.vehicles}</dd></div>
            <div><dt className="label">Ремаркета</dt><dd className="num mt-1 text-xl font-bold">{fleet.trailers.length}</dd></div>
            <div><dt className="label">Шофьори</dt><dd className="num mt-1 text-xl font-bold">{stats.drivers}</dd></div>
            <div><dt className="label">Депа</dt><dd className="num mt-1 text-xl font-bold">{stats.depots}</dd></div>
          </dl>
        </Card>
        {hub && <CompanyProgress hub={hub} />}
        <Card title="История на действията">
          <ul className="max-h-80 space-y-2 overflow-y-auto pr-2 text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex justify-between gap-3 border-b border-asphalt-800 pb-2">
                <span>{ACTION_LABEL[h.action] ?? h.action}</span>
                <span className="text-xs text-mist-400">{dateTime(h.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

type Hub = NonNullable<Awaited<ReturnType<typeof companyHub>>>;

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Company level, member bonuses and the next unlock. */
function CompanyProgress({ hub }: { hub: Hub }) {
  const c = hub.company;
  const level = c.companyLevel;
  const from = companyXpForLevel(level);
  const to = companyXpForLevel(level + 1);
  const bonuses = memberBonuses(c.upgrades as UpgradeLevels);
  const next = COMPANY_UNLOCKS.find((u) => u.level > c.companyLevel);
  return (
    <Card title="Развитие и бонуси за членовете" actions={<Link href="/game/company/development" className="text-sm text-cyan-glow hover:underline">Развитие →</Link>}>
      <div className="flex items-center justify-between text-sm"><span>Ниво {c.companyLevel}</span><span className="num text-mist-400">{int(c.companyXp - from)} / {int(to - from)} опит</span></div>
      <Meter value={Math.min(1, Math.max(0, (c.companyXp - from) / (to - from))) * 100} tone="violet" className="mt-1.5" />
      <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
        <li className="rounded-xl border border-asphalt-700 p-3"><div className="label">Възнаграждение</div><div className="num mt-1 text-lg font-bold text-profit">+{pct(bonuses.rewardMultiplier - 1)}</div></li>
        <li className="rounded-xl border border-asphalt-700 p-3"><div className="label">Наем на камион</div><div className="num mt-1 text-lg font-bold text-cyan-glow">−{Math.round(bonuses.rentalShareReduction * 100)} п.п.</div></li>
        <li className="rounded-xl border border-asphalt-700 p-3"><div className="label">Опит</div><div className="num mt-1 text-lg font-bold text-prestige">+{pct(bonuses.xpMultiplier - 1)}</div></li>
      </ul>
      {next && <p className="mt-3 text-xs text-mist-400">Следващо отключване на ниво {next.level}: {next.label}.</p>}
    </Card>
  );
}

function TextBlock({ title, icon: Icon, text, empty }: { title: string; icon: typeof ScrollText; text: string | null; empty: string }) {
  return (
    <Card title={<span className="inline-flex items-center gap-2"><Icon className="h-4 w-4 text-mist-400" />{title}</span>}>
      {text ? <p className="whitespace-pre-wrap break-words text-sm text-mist-200">{text}</p> : <p className="text-sm text-mist-400">{empty}</p>}
    </Card>
  );
}

/** What a regular member sees: profile, rules, perks and their own contribution. */
function MemberOverview({ hub }: { hub: Hub }) {
  const c = hub.company;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Моите курсове за компанията" value={int(hub.member.deliveries)} tone="cyan" icon={Route} hint={`Член от ${date(hub.member.joinedAt)}`} />
        <Stat label="Моите вноски" value={money(hub.member.contributedCents)} tone="gold" icon={Coins} hint={`Вноска ${Math.round(c.contributionRate * 100)}% от възнаграждението`} />
        <Stat label="Донесен опит" value={int(hub.member.xpContributed)} tone="prestige" icon={Star} hint="Развива компанията" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <TextBlock title="За компанията" icon={Building2} text={c.description} empty="Компанията още няма описание." />
        <TextBlock title="Правила" icon={ScrollText} text={c.rules} empty="Няма публикувани правила." />
        <CompanyProgress hub={hub} />
        <Card title={<span className="inline-flex items-center gap-2"><Gift className="h-4 w-4 text-mist-400" />Моята длъжност</span>}>
          <p className="text-sm">
            <Badge tone="violet">{hub.rank.name}</Badge>
          </p>
          <p className="mt-3 text-sm text-mist-300">
            {hub.rank.permissions.length ? 'Имате права за управление — разделите са отгоре.' : 'Карате курсове за компанията и получавате бонусите ѝ. Собственият ви камион и парите ви остават ваши.'}
          </p>
          <div className="mt-5">
            <ActionButton action={{ type: 'leaveCompany' }} className="btn-ghost text-loss" confirm="Да напуснете компанията? Губите бонусите ѝ.">Напусни компанията</ActionButton>
          </div>
        </Card>
      </div>
    </div>
  );
}
