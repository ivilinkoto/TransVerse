import { desc, eq } from 'drizzle-orm';
import { Building2, CalendarDays, Gauge, MapPin, Route, Star, Timer } from 'lucide-react';
import { Card, PageHeader, Stat } from '@/components/ui';
import { date, dateTime, int, km, money } from '@/lib/format';
import { activity } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';
import { companyStats } from '@/server/game/progression';
import { fleetView, netWorthCents } from '@/server/game/queries';

export const metadata = { title: 'Транспортна компания' };

const ACTION_LABEL: Record<string, string> = {
  registered: 'Регистрация', login: 'Вход', company_created: 'Създадена компания', contract_accepted: 'Приета поръчка', vehicle_bought: 'Купено превозно средство',
  trailer_bought: 'Купено ремарке', vehicle_sold: 'Продадено превозно средство', driver_hired: 'Нает шофьор', driver_fired: 'Освободен шофьор',
};

export default async function CompanyPage() {
  const { db, user, company, hq } = await gameContext();
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
      <PageHeader title={company.name} subtitle={<span className="inline-flex flex-wrap items-center gap-3"><span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />Седалище {hq.nameBg}</span><span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />Основана {date(company.createdAt)}</span></span>} />
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
