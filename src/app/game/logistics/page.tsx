import { and, eq, isNull, sql } from 'drizzle-orm';
import { Anchor, Warehouse } from 'lucide-react';
import { Card, PageHeader, Table } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { SelectAction } from '@/components/ui/SelectAction';
import { int, money } from '@/lib/format';
import { ECONOMY } from '@/lib/game/economy';
import { cities, cityMarkets, depots, ports, vehicles } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';
import { depotSlotCostCents } from '@/server/game/fleet';

export const metadata = { title: 'Депа' };

export default async function LogisticsPage() {
  const { db, company } = await gameContext();
  const myDepots = await db
    .select({ id: depots.id, slots: depots.slots, cityId: depots.cityId, name: cities.nameBg, country: cities.countryCode, createdAt: depots.createdAt })
    .from(depots)
    .innerJoin(cities, eq(cities.id, depots.cityId))
    .where(eq(depots.companyId, company.id));
  const parked = await db.select({ cityId: vehicles.cityId, n: sql<number>`count(*)::int` }).from(vehicles).where(and(eq(vehicles.companyId, company.id), isNull(vehicles.soldAt), eq(vehicles.status, 'idle'))).groupBy(vehicles.cityId);
  const hubs = await db
    .selectDistinct({ id: cities.id, name: cities.nameBg, country: cities.countryCode, population: cities.population })
    .from(cityMarkets)
    .innerJoin(cities, eq(cities.id, cityMarkets.cityId))
    .orderBy(sql`${cities.population} desc`)
    .limit(250);
  const portRows = await db.select({ name: ports.name, nameBg: ports.nameBg, city: cities.nameBg, country: cities.countryCode }).from(ports).innerJoin(cities, eq(cities.id, ports.cityId)).orderBy(cities.countryCode).limit(40);
  const owned = new Set(myDepots.map((d) => d.cityId));

  return (
    <div className="space-y-6">
      <PageHeader title="Депа" subtitle="Къде паркираш и купуваш техника."
        help="Депата (гаражите) определят къде купувате и паркирате техника и колко превозни средства можете да имате. Може да ги откривате и без компания." />
      <Card title="Вашите депа">
        <Table head={['Град', 'Капацитет', 'Паркирани сега', 'Открито', '']}>
          {myDepots.map((d) => (
            <tr key={d.id}>
              <td className="px-3 py-3 font-semibold"><Warehouse className="mr-2 inline h-4 w-4 text-prestige" />{d.name} <span className="text-xs text-mist-400">{d.country}</span></td>
              <td className="num px-3 py-3">{d.slots} места</td>
              <td className="num px-3 py-3">{parked.find((p) => p.cityId === d.cityId)?.n ?? 0}</td>
              <td className="px-3 py-3 text-mist-400">{d.createdAt.toLocaleDateString('bg-BG')}</td>
              <td className="px-3 py-3 text-right">
                <ActionButton action={{ type: 'expandDepot', depotId: d.id }} className="btn-ghost px-3 py-1.5 text-xs" disabled={company.balanceCents < depotSlotCostCents(d.slots)}>+1 място · {money(depotSlotCostCents(d.slots))}</ActionButton>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Открий ново депо">
          <p className="mb-3 text-sm text-mist-400">Ново депо струва {money(ECONOMY.depotPriceCents)} и идва с {ECONOMY.depotSlotsDefault} места. Възможно е в {int(hubs.length)} града, участващи в товарния пазар.</p>
          <SelectAction
            label="Открий"
            ariaLabel="Град за ново депо"
            value=""
            options={[{ value: '', label: '— изберете град —' }, ...hubs.filter((h) => !owned.has(h.id)).map((h) => ({ value: String(h.id), label: `${h.name} (${h.country}) · ${int(h.population)} жители` }))]}
            action={{ type: 'buyDepot' }}
            field="cityId"
            numeric
          />
        </Card>
        <Card title="Пристанища в региона" actions={<Anchor className="h-4 w-4 text-cyan-glow" />}>
          <ul className="grid max-h-72 gap-1.5 overflow-y-auto pr-2 text-sm sm:grid-cols-2">
            {portRows.map((p) => (
              <li key={`${p.name}-${p.city}`} className="flex justify-between gap-2 rounded-lg bg-asphalt-850 px-3 py-1.5"><span className="truncate">{p.nameBg ?? p.name}</span><span className="shrink-0 text-xs text-mist-400">{p.city}, {p.country}</span></li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-mist-400">Източник: GeoNames (CC BY 4.0). Пристанищните градове генерират контейнерни товари.</p>
        </Card>
      </div>
    </div>
  );
}
