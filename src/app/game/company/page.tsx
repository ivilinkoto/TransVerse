import { desc, eq } from 'drizzle-orm';
import { Building2, CalendarDays, CheckCircle2, Circle, Gauge, MapPin, Route, Star, Timer, Truck } from 'lucide-react';
import { FoundCompanyForm } from '@/components/game/FoundCompanyForm';
import { TutorialVisit } from '@/components/game/TutorialVisit';
import { Card, Meter, PageHeader, Stat } from '@/components/ui';
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
  password_changed: 'Сменена парола', login: 'Вход', company_created: 'Създадена компания', contract_accepted: 'Приета поръчка', vehicle_bought: 'Купено превозно средство',
  trailer_bought: 'Купено ремарке', vehicle_sold: 'Продадено превозно средство', driver_hired: 'Нает шофьор', driver_fired: 'Освободен шофьор',
};

export default async function CompanyPage() {
  const { db, user, company, hq } = await gameContext();
  const visitPending = await tutorialPending(db, user.id, 'company_goal');
  if (company.kind !== 'company') {
    const [check, cities] = await Promise.all([foundingCheck(db, user.id), headquarterOptions(db)]);
    const rows = [
      { label: `Ниво ${check.level.required}`, ok: check.level.ok, value: `сега ${check.level.current}`, share: check.level.current / check.level.required },
      { label: `${check.deliveries.required} изпълнени доставки`, ok: check.deliveries.ok, value: `${check.deliveries.current} / ${check.deliveries.required}`, share: check.deliveries.current / check.deliveries.required },
      { label: `Такса за регистрация ${money(check.funds.required)}`, ok: check.funds.ok, value: `налични ${money(check.funds.current)}`, share: Math.max(0, check.funds.current) / check.funds.required },
    ];
    return (
      <div className="space-y-6">
        <TutorialVisit step="company_goal" pending={visitPending} />
        <PageHeader title="Транспортна компания" subtitle="Засега работиш като самостоятелен шофьор с нает камион. Основи собствена компания, за да растеш." />
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
      <PageHeader title={company.name ?? ''} subtitle={<span className="inline-flex flex-wrap items-center gap-3"><span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />Седалище {hq.nameBg}</span><span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />Основана {date(company.createdAt)}</span></span>} />
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
          <p className="mt-4 flex items-center gap-2 text-xs text-mist-400"><Gauge className="h-3.5 w-3.5" />Партньорства и съвместни компании ще бъдат добавени в следващ етап.</p>
        </Card>
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
