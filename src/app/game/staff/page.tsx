import { canHireStaff } from '@/server/game/company';
import { UserPlus, UserRound } from 'lucide-react';
import { Badge, Card, Empty, PageHeader, Table } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { SelectAction } from '@/components/ui/SelectAction';
import { int, money } from '@/lib/format';
import { CompanyRequired } from '@/components/game/CompanyRequired';
import { gameContext } from '@/server/game/context';
import { fleetView } from '@/server/game/queries';
import { candidates } from '@/server/game/staff';

export const metadata = { title: 'Служители' };

const Stars = ({ n }: { n: number }) => <span className="text-gold-400" aria-label={`Умение ${n} от 5`}>{'★'.repeat(n)}<span className="text-asphalt-500">{'★'.repeat(5 - n)}</span></span>;

export default async function StaffPage() {
  const { db, user, company } = await gameContext();
  if (!(await canHireStaff(db, user.id, company))) return <CompanyRequired what="Наемането на шофьори" />;
  const [fleet, pool] = await Promise.all([fleetView(db, company.id), candidates(db, company.id)]);
  const payroll = fleet.drivers.reduce((s, d) => s + d.salaryCentsPerDay, 0);
  const vehicleOptions = [{ value: '', label: '— без превозно средство —' }, ...fleet.vehicles.map((v) => ({ value: v.id, label: `${v.plate} · ${v.model.name}${v.driver ? ` (сега: ${v.driver.name})` : ''}`, disabled: !!v.delivery }))];

  return (
    <div className="space-y-6">
      <PageHeader title="Служители" subtitle={`Шофьорите карат, трупат опит и растат в умения: по-малко гориво и по-бърза доставка. Дневни заплати: ${money(payroll)}.`} />
      <Card title={`Шофьори (${fleet.drivers.length})`}>
        {fleet.drivers.length === 0 ? (
          <Empty icon={UserRound} title="Нямате шофьори">Без шофьор превозното средство не може да тръгне. Наемете от кандидатите по-долу.</Empty>
        ) : (
          <Table head={['Име', 'Умение', 'Опит', 'Заплата / ден', 'Превозно средство', '']}>
            {fleet.drivers.map((d) => {
              const v = fleet.vehicles.find((x) => x.id === d.vehicleId);
              return (
                <tr key={d.id}>
                  <td className="px-3 py-3 font-semibold">{d.name}</td>
                  <td className="px-3 py-3"><Stars n={d.skill} /></td>
                  <td className="num px-3 py-3 text-mist-300">{int(d.xp)}</td>
                  <td className="num px-3 py-3">{money(d.salaryCentsPerDay)}</td>
                  <td className="min-w-[260px] px-3 py-3">
                    {v?.delivery ? <Badge tone="cyan">на курс с {v.plate}</Badge> : (
                      <SelectAction label="Назначи" ariaLabel={`Превозно средство за ${d.name}`} value={d.vehicleId ?? ''} options={vehicleOptions} action={{ type: 'assignDriver', driverId: d.id }} field="vehicleId" />
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <ActionButton action={{ type: 'fireDriver', driverId: d.id }} className="btn-danger px-3 py-1.5 text-xs" confirm={`Обезщетение ${money(d.salaryCentsPerDay * 3)}. Освобождаване?`} disabled={!!v?.delivery}>Освободи</ActionButton>
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
      <Card title="Кандидати" actions={<span className="text-xs text-mist-400">Обновяват се на всеки 24 часа</span>}>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {pool.map((c) => (
            <li key={c.id} className="rounded-xl border border-asphalt-700 bg-asphalt-850 p-4">
              <div className="font-semibold">{c.name}</div>
              <div className="mt-1 text-sm"><Stars n={c.skill} /></div>
              <div className="num mt-2 text-sm text-mist-300">{money(c.salaryCentsPerDay)} / ден</div>
              <div className="mt-3">
                <ActionButton action={{ type: 'hireDriver', candidateId: c.id }} className="btn-primary px-3 py-2 text-sm"><UserPlus className="h-4 w-4" />Наеми</ActionButton>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
