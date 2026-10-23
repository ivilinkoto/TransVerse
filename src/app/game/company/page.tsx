import { and, eq, isNull } from 'drizzle-orm';
import { Building2, Bus, Cake, CalendarDays, CheckCircle2, Circle, Coins, Gift, Landmark, MapPin, Route, ScrollText, Star, Truck, Users } from 'lucide-react';
import Link from 'next/link';
import { CompanySeason } from '@/components/company/CompanySeason';
import { getDb } from '@/server/db/client';
import { ActionButton } from '@/components/ui/ActionButton';
import { companyXpForLevel, COMPANY_UNLOCKS, memberBonuses, memberCapacity, type UpgradeLevels } from '@/lib/game/company';
import { DepositForm } from '@/components/company/forms';
import { CompanyLicences } from '@/components/company/CompanyLicences';
import { companyLicenceSet } from '@/server/game/licences';
import { companyHub, myApplications, treasuryHistory } from '@/server/game/membership';
import { TREASURY_LABELS, type TreasuryCategory } from '@/server/game/finance';
import { FoundCompanyForm } from '@/components/game/FoundCompanyForm';
import { TutorialVisit } from '@/components/game/TutorialVisit';
import { Badge, Card, Meter, PageHeader, Stat } from '@/components/ui';
import { ECONOMY } from '@/lib/game/economy';
import { foundingCheck, headquarterOptions } from '@/server/game/company';
import { tutorialPending } from '@/server/game/tutorial-flags';
import { date, dateTime, int, money } from '@/lib/format';
import { gameContext } from '@/server/game/context';
import { SelectAction } from '@/components/ui/SelectAction';
import { daysToAnniversary, DRIVER_OF_MONTH, STAFF_BUS } from '@/lib/game/community';
import { vehicles } from '@/server/db/schema';
import { staffBusState } from '@/server/game/community';
import { chronicleOf } from '@/server/game/chronicle';

export const metadata = { title: 'Транспортна компания' };


export default async function CompanyPage() {
  const { db, user, company, now, features } = await gameContext();
  const visitPending = await tutorialPending(db, user.id, 'company_goal');
  const hub = await companyHub(db, user.id);
  if (hub) {
    return (
      <>
        <TutorialVisit step="company_goal" pending={visitPending} />
        <CompanyOverview hub={hub} history={await treasuryHistory(db, hub.company.id, 15)} licences={await companyLicenceSet(db, hub.company.id)} extras={{ bus: features.staff_bus ? await staffBusView(db, user.id, company.id, now) : null, anniversaryIn: features.anniversary ? daysToAnniversary(hub.company.foundedAt, now) : null, chronicle: features.chronicle ? await chronicleOf(db, hub.company.id, 20) : null, driverOfMonth: features.driver_of_month }} />
      </>
    );
  }
    const [check, cities, applications] = await Promise.all([foundingCheck(db, user.id), headquarterOptions(db), myApplications(db, user.id)]);
    const rows = [
      { label: `Ниво ${check.level.required}`, ok: check.level.ok, value: `сега ${check.level.current}`, share: check.level.current / check.level.required },
      { label: `${check.deliveries.required} изпълнени доставки`, ok: check.deliveries.ok, value: `${check.deliveries.current} / ${check.deliveries.required}`, share: check.deliveries.current / check.deliveries.required },
      { label: `Такса за регистрация ${money(check.funds.required)}`, ok: check.funds.ok, value: `налични ${money(check.funds.current)}`, share: Math.max(0, check.funds.current) / check.funds.required },
    ];
    return (
      <div className="space-y-6">
        <TutorialVisit step="company_goal" pending={visitPending} />
        <PageHeader title="Транспортна компания" subtitle={company.kind === 'company' ? 'В момента не членуваш в компания. Твоят автопарк и лиценз остават твои — присъедини се към компания на друг играч или основи нова.' : 'Засега работиш като самостоятелен шофьор с нает камион. Присъедини се към компания на друг играч или основи своя.'} />
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
                <li>Седалище и безплатно депо с {ECONOMY.depotSlotsDefault} места</li>
                <li>Наем на допълнителни камиони</li>
                <li>Наемане на шофьори — повече курсове едновременно</li>
                <li>Каса, членове, длъжности и бонуси за екипа</li>
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
      <div className="flex items-center justify-between text-sm"><span>Ниво {c.companyLevel}</span><span className="num text-mist-400">{int(Math.max(0, c.companyXp - from))} / {int(to - from)} опит</span></div>
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

type History = Awaited<ReturnType<typeof treasuryHistory>>;

/** What every member (the owner included) sees: the company, its treasury, perks and their own share. */
async function staffBusView(db: ReturnType<typeof getDb>, userId: string, accountId: string, now: Date) {
  const state = await staffBusState(db, userId, now);
  if (!state || (!state.available && !state.firstTripBonus)) return null;
  const trucks = state.available ? await db.select({ id: vehicles.id, plate: vehicles.plate, cityId: vehicles.cityId }).from(vehicles).where(and(eq(vehicles.companyId, accountId), isNull(vehicles.soldAt), eq(vehicles.status, 'idle'))) : [];
  return { ...state, trucks: trucks.filter((t) => t.cityId !== state.hqCityId) };
}

type Extras = { bus: Awaited<ReturnType<typeof staffBusView>>; anniversaryIn: number | null; chronicle: Awaited<ReturnType<typeof chronicleOf>> | null; driverOfMonth: boolean };

const CHRONICLE_ICON: Record<string, string> = { driver: '🚚', founded: '🏁', level: '⭐', build: '🏗️', battle: '⚔️', project: '📦', division: '🏆', anniversary: '🎂', alliance: '🛡', specialization: '🎯' };

/** The company's big moments (v1.5). */
function Chronicle({ items }: { items: NonNullable<Extras['chronicle']> }) {
  return (
    <Card title={<span className="inline-flex items-center gap-2"><ScrollText className="h-4 w-4 text-mist-400" />Хроника</span>} className="lg:col-span-2">
      <ol className="relative space-y-3 border-l border-asphalt-700 pl-5">
        {items.map((c) => (
          <li key={c.id} className="text-sm">
            <span className="absolute -left-2.5 grid h-5 w-5 place-items-center rounded-full bg-asphalt-850 text-xs" aria-hidden="true">{CHRONICLE_ICON[c.kind] ?? '•'}</span>
            <div>{c.text}</div>
            <div className="text-xs text-mist-400">{date(c.at)}</div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** The staff bus for a new member and the first-trip bonus (v1.5). */
function StaffBus({ bus, hq }: { bus: NonNullable<Extras['bus']>; hq: string }) {
  return (
    <Card title={<span className="inline-flex items-center gap-2"><Bus className="h-4 w-4 text-cyan-glow" />Фирмен автобус</span>}>
      {bus.available && (
        <div className="space-y-2 text-sm">
          <p className="text-mist-300">Добре дошъл! Компанията праща автобус: един твой свободен камион (с ремаркето) идва в {hq} за минута, безплатно. Важи до {date(bus.until)}.</p>
          {bus.trucks.length ? <SelectAction label="Докарай" ariaLabel="Камион до базата" value="" options={[{ value: '', label: '— избери камион —' }, ...bus.trucks.map((t) => ({ value: t.id, label: t.plate }))]} action={{ type: 'staffBus' }} field="vehicleId" /> : <p className="text-xs text-mist-400">Нямаш свободен камион извън {hq}.</p>}
        </div>
      )}
      {bus.firstTripBonus && <p className="mt-2 text-sm text-profit">Първият ти курс като член носи +{Math.round(STAFF_BUS.firstTripShare * 100)} % към наградата.</p>}
    </Card>
  );
}

function CompanyOverview({ hub, history, licences, extras }: { hub: Hub; history: History; licences: { licence: string; acquiredAt: Date }[]; extras: Extras }) {
  const c = hub.company;
  const capacity = memberCapacity(c.upgrades as UpgradeLevels);
  return (
    <div className="space-y-6">
      <p className="flex flex-wrap items-center gap-3 text-sm text-mist-400">
        <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />Седалище {hub.hq}</span>
        <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />Основана {date(c.foundedAt)}</span>
        {extras.anniversaryIn != null && <span className="inline-flex items-center gap-1"><Cake className="h-3.5 w-3.5" />{extras.anniversaryIn === 0 ? 'Днес е рожденият ден на компанията!' : `Годишнина след ${extras.anniversaryIn} ${extras.anniversaryIn === 1 ? 'ден' : 'дни'}`}</span>}
        <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />Собственик {hub.owner}</span>
      </p>
      <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        <Stat label="Каса на компанията" value={money(c.treasuryCents)} tone="gold" icon={Landmark} hint="Отделно от личните пари на членовете" />
        <Stat label="Членове" value={`${int(hub.members)} / ${capacity}`} tone="cyan" icon={Users} hint={`Набиране: ${c.recruitment === 'open' ? 'отворено' : c.recruitment === 'application' ? 'с кандидатура' : 'затворено'}`} />
        <Stat label="Курсове на членовете" value={int(hub.memberDeliveries)} tone="profit" icon={Route} hint={`Вноска ${Math.round(c.contributionRate * 100)}% от възнаграждението`} />
        <Stat label="Ниво на компанията" value={c.companyLevel} tone="prestige" icon={Star} hint={`${int(c.companyXp)} опит`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <TextBlock title="За компанията" icon={Building2} text={c.description} empty="Компанията още няма описание." />
        <TextBlock title="Правила" icon={ScrollText} text={c.rules} empty="Няма публикувани правила." />
        {extras.bus && <StaffBus bus={extras.bus} hq={hub.hq} />}
        {extras.driverOfMonth && (
          <Card title={<span className="inline-flex items-center gap-2"><Truck className="h-4 w-4 text-gold-400" />Шофьор на месеца</span>}>
            {c.driverOfMonth ? <p className="text-sm"><b>{c.driverOfMonth.username}</b> <span className="text-mist-400">· {c.driverOfMonth.month} · {c.driverOfMonth.trips} курса · {int(Math.round(c.driverOfMonth.tons))} т</span></p> : <p className="text-sm text-mist-400">Още няма — избира се в началото на всеки месец (най-много курсове, поне {DRIVER_OF_MONTH.minTrips}).</p>}
            <p className="mt-1 text-xs text-mist-400">Значка „Шофьор на месеца“{c.driverOfMonthPrizeCents ? ` и премия ${money(c.driverOfMonthPrizeCents)} от касата` : ''}.</p>
            {(hub.rank.isOwner || hub.rank.permissions.includes('manage_settings')) && (
              <div className="mt-3 max-w-xs"><SelectAction label="Запази" ariaLabel="Премия за шофьор на месеца" value={String(c.driverOfMonthPrizeCents)} numeric field="cents" action={{ type: 'driverOfMonthPrize' }} options={DRIVER_OF_MONTH.prizes.map((p) => ({ value: String(p), label: p ? `Премия ${money(p)}` : 'Без премия' }))} /></div>
            )}
          </Card>
        )}
        {extras.chronicle && <Chronicle items={extras.chronicle} />}
        <CompanyProgress hub={hub} />
        <CompanySeason db={getDb()} organizationId={c.id} />
        <CompanyLicences held={licences} canBuy={hub.rank.isOwner || hub.rank.permissions.includes('manage_upgrades')} treasuryCents={c.treasuryCents} />
        <Card title={<span className="inline-flex items-center gap-2"><Gift className="h-4 w-4 text-mist-400" />Моето членство</span>}>
          <div className="flex flex-wrap items-center gap-2 text-sm"><Badge tone={hub.rank.isOwner ? 'gold' : 'violet'}>{hub.rank.name}</Badge><span className="text-mist-400">член от {date(hub.member.joinedAt)}</span></div>
          <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
            <div><dt className="label">Курсове</dt><dd className="num mt-1 text-lg font-bold">{int(hub.member.deliveries)}</dd></div>
            <div><dt className="label">Внесени</dt><dd className="num mt-1 text-lg font-bold text-gold-400">{money(hub.member.contributedCents)}</dd></div>
            <div><dt className="label">Опит</dt><dd className="num mt-1 text-lg font-bold text-prestige">{int(hub.member.xpContributed)}</dd></div>
          </dl>
          <div className="mt-5 border-t border-asphalt-800 pt-4">
            {hub.rank.isOwner ? (
              <p className="text-sm text-mist-300">Като собственик можете да напуснете само след като предадете собствеността на друг член. <Link href="/game/company/settings#ownership" className="text-cyan-glow hover:underline">Собственост →</Link></p>
            ) : (
              <ActionButton action={{ type: 'leaveCompany' }} className="btn-ghost text-loss" confirm="Да напуснете компанията? Губите бонусите ѝ.">Напусни компанията</ActionButton>
            )}
          </div>
        </Card>
        <Card title={<span className="inline-flex items-center gap-2"><Coins className="h-4 w-4 text-mist-400" />Каса</span>} className="lg:col-span-2">
          <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
            <div>
              <div className="num font-display text-3xl font-bold text-gold-400">{money(c.treasuryCents)}</div>
              <p className="mt-2 text-sm text-mist-300">Касата е на компанията, не на собственика. Пълни се от вноските от всеки курс на член и от доброволни вноски, а се харчи само за развитие на компанията. Пари от касата не могат да се теглят лично.</p>
              <div className="mt-4"><DepositForm /></div>
            </div>
            <div>
              <div className="label mb-2">Последни движения</div>
              {history.length === 0 ? (
                <p className="text-sm text-mist-400">Още няма движения.</p>
              ) : (
                <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-2 text-sm">
                  {history.map(({ entry, actor }) => (
                    <li key={entry.id} className="flex items-start justify-between gap-3 border-b border-asphalt-800 pb-1.5">
                      <span className="min-w-0">
                        <span className="block truncate">{entry.description}</span>
                        <span className="text-xs text-mist-400">{TREASURY_LABELS[entry.category as TreasuryCategory] ?? entry.category}{actor ? ` · ${actor}` : ''} · {dateTime(entry.createdAt)}</span>
                      </span>
                      <span className={`num shrink-0 font-semibold ${entry.amountCents >= 0 ? 'text-profit' : 'text-loss'}`}>{entry.amountCents >= 0 ? '+' : ''}{money(entry.amountCents)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
