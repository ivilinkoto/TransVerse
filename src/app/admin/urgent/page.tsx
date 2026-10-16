import { sql } from 'drizzle-orm';
import { UrgentContractForm } from '@/components/admin/UrgentContractForm';
import { Badge, Card, PageHeader, Table } from '@/components/ui';
import { dateTime, duration, km, money } from '@/lib/format';
import { CARGO } from '@/lib/game/cargo';
import { isFreightHub } from '@/lib/game/markets';
import { isAdmin } from '@/server/auth/roles';
import { cities } from '@/server/db/schema';
import { adminContext } from '@/server/admin-context';
import { urgentContracts } from '@/server/urgent';

export const metadata = { title: 'Спешни доставки' };

export default async function UrgentPage() {
  const { db, user, now } = await adminContext();
  const [cityRows, recent] = await Promise.all([
    db.select({ id: cities.id, name: cities.nameBg, country: cities.countryCode, population: cities.population }).from(cities).orderBy(cities.countryCode, sql`${cities.population} desc`),
    urgentContracts(db),
  ]);
  const options = cityRows.filter((c) => isFreightHub({ population: c.population, country: c.country })).map((c) => ({ id: c.id, name: c.name, country: c.country }));
  return (
    <div className="space-y-6">
      <PageHeader title="Спешни доставки" subtitle="Публикувай спешна поръчка: показва се най-отгоре на борсата с бадж „СПЕШНО“, камионът стига до товара за 1 минута, а курсът върви по-бързо. Докато не изтече, може да я поеме всеки играч със свободен подходящ камион и лицензи — всеки по веднъж и всеки получава цената." />
      {isAdmin(user.role) ? (
        <Card title="Нова спешна доставка">
          <UrgentContractForm cities={options} cargoTypes={Object.values(CARGO).map((c) => ({ id: c.id, label: c.label, maxTons: c.tons[1] }))} />
        </Card>
      ) : (
        <Card><p className="text-sm text-mist-400">Спешни доставки се създават от администратор.</p></Card>
      )}
      <Card title="Последни спешни доставки">
        <Table head={['Създадена', 'Товар', 'Маршрут', 'Цена', 'Срок', 'Скорост', 'Поели / доставили', 'Състояние']}>
          {recent.map(({ contract: c, takers, delivered, from, to }) => (
            <tr key={c.id}>
              <td className="px-3 py-2 text-mist-400">{dateTime(c.createdAt)}</td>
              <td className="px-3 py-2 font-semibold">{c.goods} <span className="text-xs font-normal text-mist-400">{c.weightTons} т</span></td>
              <td className="px-3 py-2">{from} → {to} <span className="text-xs text-mist-400">{km(c.distanceKm)}</span></td>
              <td className="num px-3 py-2 text-profit">{money(c.rewardCents)}</td>
              <td className="px-3 py-2">{duration(c.windowMinutes)}</td>
              <td className="num px-3 py-2">×{c.speedFactor}</td>
              <td className="num px-3 py-2">{takers} / {delivered}</td>
              <td className="px-3 py-2">
                {c.status === 'open' && c.expiresAt > now ? <Badge tone="red">на борсата до {dateTime(c.expiresAt)}</Badge> : <Badge>изтекла</Badge>}
              </td>
            </tr>
          ))}
        </Table>
        {recent.length === 0 && <p className="mt-3 text-sm text-mist-400">Все още няма спешни доставки.</p>}
      </Card>
    </div>
  );
}
