import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Backpack } from 'lucide-react';
import { eq } from 'drizzle-orm';
import { Card, Empty, PageHeader } from '@/components/ui';
import { InventoryGrid } from '@/components/game/InventoryGrid';
import { ItemArt } from '@/components/game/ItemArt';
import { drivers, vehicles } from '@/server/db/schema';
import { COLLECTION, ITEMS, type ItemId } from '@/lib/game/items';
import { dateTime } from '@/lib/format';
import { gameContext } from '@/server/game/context';
import { activeEffects, inventoryOf, recentItems } from '@/server/game/inventory';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Инвентар') };
}

const EFFECT_LABELS: Record<string, string> = { no_rest: 'Без почивка', cover_late: 'Застраховка за един курс', queue_extra: '+2 места в опашката' };

/** 1.2 „Инвентар“: items, cases, the collection and what is in effect now. */
export default async function InventoryPage() {
  await initLocale();
  const { db, user, company, now, features } = await gameContext();
  if (!features.inventory) notFound();
  const [items, log, effects, crew, fleet] = await Promise.all([
    inventoryOf(db, user.id),
    recentItems(db, user.id),
    activeEffects(db, user.id, now),
    db.select({ id: drivers.id, name: drivers.name }).from(drivers).where(eq(drivers.companyId, company.id)),
    db.select({ id: vehicles.id, plate: vehicles.plate, nickname: vehicles.nickname }).from(vehicles).where(eq(vehicles.companyId, company.id)),
  ]);
  const everFound = new Set(log.filter((l) => l.delta > 0).map((l) => l.itemId));
  const have = new Set(items.map((i) => i.itemId));
  return (
    <div className="space-y-6">
      <PageHeader title={t('Инвентар')} subtitle={t('Предмети, кейсове и колекции. Кейсовете се печелят само с игра — шансът на всеки предмет се вижда.')} />
      {!items.length ? (
        <Empty icon={Backpack} title={t('Инвентарът е празен')}>{t('Кейсове падат от дневната награда, новите нива, Голям рейс и находки по пътя.')}</Empty>
      ) : (
        <InventoryGrid items={items} drivers={crew.map((d) => ({ id: d.id, label: d.name }))} vehicles={fleet.map((v) => ({ id: v.id, label: v.nickname ? `${v.nickname} · ${v.plate}` : v.plate }))} />
      )}
      {effects.length > 0 && (
        <Card title={t('Действа сега')}>
          <ul className="space-y-1 text-sm">
            {effects.map((e) => {
              const who = crew.find((d) => d.id === e.driverId)?.name;
              return <li key={e.id}>{tx(EFFECT_LABELS[e.effect] ?? e.effect)}{who ? ` · ${who}` : ''}{e.until ? t(' · до {0}', dateTime(e.until)) : ''}</li>;
            })}
          </ul>
        </Card>
      )}
      <Card title={t('Колекция „Спомени от пътя“ ({0}/{1})', COLLECTION.items.filter((i) => everFound.has(i) || have.has(i)).length, COLLECTION.items.length)}>
        <ul className="flex flex-wrap gap-3">
          {COLLECTION.items.map((id) => {
            const got = everFound.has(id) || have.has(id);
            return (
              <li key={id} className={`flex w-24 flex-col items-center gap-1 text-center text-[11px] ${got ? '' : 'opacity-30 grayscale'}`}>
                <ItemArt id={id} className="h-14 w-14" />
                {got ? tx(ITEMS[id].name) : '?'}
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-mist-400">{t('Всички четири — значка и {0} ТрансКоин.', COLLECTION.coins)}</p>
      </Card>
      {log.length > 0 && (
        <Card title={t('Последно')}>
          <ul className="space-y-1 text-sm">
            {log.map((l, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">{l.itemId in ITEMS && <ItemArt id={l.itemId as ItemId} className="h-6 w-6" />}{l.itemId in ITEMS ? tx(ITEMS[l.itemId as ItemId].name) : l.itemId}</span>
                <span className={`num ${l.delta > 0 ? 'text-profit' : 'text-mist-400'}`}>{l.delta > 0 ? `+${l.delta}` : l.delta} · {dateTime(l.at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
