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
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Спешни доставки') };
}

export default async function UrgentPage() {
  await initLocale();
  const { db, user, now } = await adminContext();
  const [cityRows, recent] = await Promise.all([
    db.select({ id: cities.id, name: cities.nameBg, country: cities.countryCode, population: cities.population }).from(cities).orderBy(cities.countryCode, sql`${cities.population} desc`),
    urgentContracts(db),
  ]);
  const options = cityRows.filter((c) => isFreightHub({ population: c.population, country: c.country })).map((c) => ({ id: c.id, name: c.name, country: c.country }));
  return (
    <div className="space-y-6">
      <PageHeader title={t('Спешни доставки')} subtitle={t('Публикувай спешна поръчка: показва се най-отгоре на борсата с бадж „СПЕШНО“, камионът стига до товара за 1 минута, а курсът върви по-бързо. Докато не изтече, може да я поеме всеки играч със свободен подходящ камион и лицензи — всеки по веднъж и всеки получава цената. Освен тук, системата сама пуска спешни доставки през произволни интервали (1,5–5 часа).')} />
      {isAdmin(user.role) ? (
        <Card title={t('Нова спешна доставка')}>
          <UrgentContractForm cities={options} cargoTypes={Object.values(CARGO).map((c) => ({ id: c.id, label: c.label, maxTons: c.tons[1] }))} />
        </Card>
      ) : (
        <Card><p className="text-sm text-mist-400">{t('Спешни доставки се създават от администратор.')}</p></Card>
      )}
      <Card title={t('Последни спешни доставки')}>
        <Table head={[t('Създадена'), t('Товар'), t('Маршрут'), t('Цена'), t('Срок'), t('Скорост'), t('Поели / доставили'), t('Състояние')]}>
          {recent.map(({ contract: c, takers, delivered, from, to }) => (
            <tr key={c.id}>
              <td className="px-3 py-2 text-mist-400">{dateTime(c.createdAt)}</td>
              <td className="px-3 py-2 font-semibold">{tx(c.goods)} <span className="text-xs font-normal text-mist-400">{t('{0} т', c.weightTons)}</span>{!c.createdBy && <span className="ml-1.5"><Badge tone="violet">{t('автоматична')}</Badge></span>}</td>
              <td className="px-3 py-2">{from} → {to} <span className="text-xs text-mist-400">{km(c.distanceKm)}</span></td>
              <td className="num px-3 py-2 text-profit">{money(c.rewardCents)}</td>
              <td className="px-3 py-2">{duration(c.windowMinutes)}</td>
              <td className="num px-3 py-2">×{tx(c.speedFactor)}</td>
              <td className="num px-3 py-2">{takers} / {delivered}</td>
              <td className="px-3 py-2">
                {c.status === 'open' && c.expiresAt > now ? <Badge tone="red">{t('на борсата до {0}', dateTime(c.expiresAt))}</Badge> : <Badge>{t('изтекла')}</Badge>}
              </td>
            </tr>
          ))}
        </Table>
        {recent.length === 0 && <p className="mt-3 text-sm text-mist-400">{t('Все още няма спешни доставки.')}</p>}
      </Card>
    </div>
  );
}
