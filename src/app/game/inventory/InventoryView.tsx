import { Backpack } from 'lucide-react';
import { eq } from 'drizzle-orm';
import { Card, Empty } from '@/components/ui';
import { InventoryGrid } from '@/components/game/InventoryGrid';
import { InventorySeen } from '@/components/game/InventorySeen';
import { ActionButton } from '@/components/ui/ActionButton';
import { DriverPortrait } from '@/components/game/DriverPortrait';
import Link from 'next/link';
import { ItemArt } from '@/components/game/ItemArt';
import { drivers, vehicles } from '@/server/db/schema';
import { COLLECTION, FRAME_ITEMS, ITEMS, RARITIES, type ItemId } from '@/lib/game/items';
import { WEEKLY_CHEST } from '@/lib/game/item-chests';
import { dateTime } from '@/lib/format';
import { gameContext } from '@/server/game/context';
import { activeEffects, inventoryOf, recentItems } from '@/server/game/inventory';
import { activeTreasure, foundItems, pendingExchanges, provenance, soldToday, weeklyChest } from '@/server/game/item-trade';
import { friendsOf } from '@/server/game/social';
import { and, gt, isNull } from 'drizzle-orm';
import { itemLog } from '@/server/db/schema';
import { t, tx } from '@/i18n/t';
import { EmptyAction } from '@/components/game/EmptyAction';

const EFFECT_LABELS: Record<string, string> = { no_rest: 'Без почивка', cover_late: 'Застраховка за един курс', queue_extra: '+2 места в опашката', treasure: 'Карта на съкровището' };

/** 1.2 „Инвентар“: items, cases, the collection and what is in effect now (the page and the game window). */
export async function InventoryView() {
  const { db, user, company, now, features } = await gameContext();
  const [items, log, effects, crew, fleet] = await Promise.all([
    inventoryOf(db, user.id),
    recentItems(db, user.id),
    activeEffects(db, user.id, now),
    db.select({ id: drivers.id, name: drivers.name, look: drivers.look }).from(drivers).where(eq(drivers.companyId, company.id)),
    db.select({ id: vehicles.id, plate: vehicles.plate, nickname: vehicles.nickname }).from(vehicles).where(eq(vehicles.companyId, company.id)),
  ]);
  const everFound = new Set(log.filter((l) => l.delta > 0).map((l) => l.itemId));
  const have = new Set(items.map((i) => i.itemId));
  // 1.2.1: what the new inventory shows besides the items.
  const menu = features.inventory_menu;
  const since = user.uiPrefs?.inventorySeenAt ? new Date(user.uiPrefs.inventorySeenAt) : new Date(now.getTime() - 3 * 86_400_000);
  const [freshRows, found, origin, social, exchanges, sold, week, treasure] = menu
    ? await Promise.all([
        db.selectDistinct({ itemId: itemLog.itemId }).from(itemLog).where(and(eq(itemLog.userId, user.id), gt(itemLog.delta, 0), gt(itemLog.createdAt, since))),
        foundItems(db, user.id),
        provenance(db, user.id, items.map((i) => i.itemId).filter((x): x is ItemId => x in ITEMS)),
        features.item_trade ? friendsOf(db, user.id, now) : null,
        features.item_trade ? pendingExchanges(db, user.id) : null,
        features.item_trade ? soldToday(db, user.id, now) : 0,
        features.item_chests ? weeklyChest(db, user.id, now) : null,
        features.item_album ? activeTreasure(db, user.id, now) : null,
      ])
    : [[], new Map<ItemId, Date>(), {}, null, null, 0, null, null];
  const extras = menu
    ? {
        fresh: freshRows.map((r) => r.itemId).filter((x): x is ItemId => x in ITEMS),
        found: [...found.keys()],
        provenance: Object.fromEntries(Object.entries(origin).map(([k, v]) => [k, { ...v!, at: v!.at.toISOString() }])),
        friends: (social?.friends ?? []).map((f) => ({ id: f.id, username: f.username })),
        soldToday: sold,
        level: user.level,
      }
    : undefined;
  const worn = crew.filter((d) => d.look && (d.look.cap || d.look.glasses || d.look.frame));
  return (
    <div className="space-y-6">
      {menu && <InventorySeen />}
      {exchanges && (exchanges.gifts.length > 0 || exchanges.incoming.length > 0 || exchanges.outgoing.length > 0) && (
        <Card title={t('Подаръци и размени')} className="border-violet-500/40 bg-gradient-to-br from-violet-700/15 to-transparent">
          <div className="space-y-3">
            {exchanges.gifts.map((g) => (
              <div key={g.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-gold-400/30 bg-asphalt-900/60 p-3">
                <span className="fx-case-wobble text-3xl" aria-hidden="true">🎁</span>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold">{t('Подарък от {0}', g.from)}</p>
                  {g.note && <p className="text-xs italic text-mist-300">„{g.note}“</p>}
                </div>
                <ActionButton action={{ type: 'openGift', id: g.id }} className="btn-primary px-3 py-1.5 text-sm">{t('Разопаковай')}</ActionButton>
              </div>
            ))}
            {exchanges.incoming.map((x) => (
              <div key={x.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-cyan-glow/30 bg-asphalt-900/60 p-3 text-sm">
                <span className="flex items-center gap-1"><ItemArt id={x.give} className="h-9 w-9" />⇄<ItemArt id={x.want} className="h-9 w-9" /></span>
                <div className="min-w-0 flex-1">
                  <p>{t('{0} дава {1} за твоя {2}', x.from, tx(ITEMS[x.give].name), tx(ITEMS[x.want].name))}</p>
                  {x.note && <p className="text-xs italic text-mist-300">„{x.note}“</p>}
                </div>
                <ActionButton action={{ type: 'answerTrade', id: x.id, answer: 'accept' }} className="btn-primary px-3 py-1.5 text-sm" disabled={!have.has(x.want)}>{t('Приеми')}</ActionButton>
                <ActionButton action={{ type: 'answerTrade', id: x.id, answer: 'decline' }} className="btn-ghost px-3 py-1.5 text-sm">{t('Откажи')}</ActionButton>
              </div>
            ))}
            {exchanges.outgoing.map((x) => (
              <div key={x.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-asphalt-700 bg-asphalt-900/40 p-3 text-sm text-mist-300">
                <span className="flex items-center gap-1"><ItemArt id={x.give} className="h-8 w-8" />⇄<ItemArt id={x.want} className="h-8 w-8" /></span>
                <p className="min-w-0 flex-1">{t('Чакаш {0}: {1} за {2}', x.to, tx(ITEMS[x.give].name), tx(ITEMS[x.want].name))}</p>
                <ActionButton action={{ type: 'answerTrade', id: x.id, answer: 'cancel' }} className="btn-ghost px-3 py-1.5 text-xs">{t('Върни предложението')}</ActionButton>
              </div>
            ))}
          </div>
        </Card>
      )}
      {(week || treasure) && (
        <div className="grid gap-4 md:grid-cols-2">
          {week && (
            <Card title={t('Седмичен сандък')}>
              <div className="flex items-center gap-3">
                <ItemArt id={week.claimed ?? week.tier?.item ?? WEEKLY_CHEST[0]!.item} className={`h-16 w-16 ${week.tier || week.claimed ? '' : 'opacity-40 grayscale'}`} />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="num">{t('Курсове тази седмица: {0}', week.trips)}</p>
                  <p className="text-xs text-mist-400">{WEEKLY_CHEST.map((c) => t('{0} → {1}', c.trips, tx(ITEMS[c.item].name))).join(' · ')}</p>
                  {week.claimed ? <p className="text-xs text-profit">{t('Взет: {0}. Нов сандък от понеделник.', tx(ITEMS[week.claimed].name))}</p> : week.next && <p className="text-xs text-mist-300">{t('Още {0} курса до {1}.', week.next.trips - week.trips, tx(ITEMS[week.next.item].name))}</p>}
                </div>
              </div>
              {!week.claimed && week.tier && <div className="mt-3"><ActionButton action={{ type: 'claimWeeklyChest' }} className="btn-primary w-full" confirm={week.next ? t('Сандъкът е веднъж седмично. Вземи {0} сега или карай още до {1}?', tx(ITEMS[week.tier.item].name), tx(ITEMS[week.next.item].name)) : undefined}>{t('Вземи {0}', tx(ITEMS[week.tier.item].name))}</ActionButton></div>}
            </Card>
          )}
          {treasure && (
            <Card title={t('Карта на съкровището')}>
              <div className="flex items-center gap-3">
                <ItemArt id="treasure_map" className="h-16 w-16" />
                <p className="text-sm">{t('Съкровището е в {0}. Достави товар там до {1}.', tx(treasure.cityName), dateTime(treasure.until))}</p>
              </div>
              <Link href={`/game/contracts?q=${encodeURIComponent(treasure.cityName)}`} className="btn-ghost mt-3 w-full">{t('Поръчки до {0}', tx(treasure.cityName))}</Link>
            </Card>
          )}
        </div>
      )}
      {!items.length ? (
        <Empty icon={Backpack} title={t('Инвентарът е празен')}>{t('Кейсове падат от дневната награда, новите нива, Голям рейс и находки по пътя.')}<EmptyAction href="/game/missions" label="Към мисиите" /></Empty>
      ) : (
        <InventoryGrid items={items} drivers={crew.map((d) => ({ id: d.id, label: d.name, look: d.look ?? {} }))} vehicles={fleet.map((v) => ({ id: v.id, label: v.nickname ? `${v.nickname} · ${v.plate}` : v.plate }))} extras={extras} />
      )}
      {menu && worn.length > 0 && (
        <Card title={t('Облечено на шофьорите')}>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {worn.map((d) => (
              <li key={d.id} className="flex items-center gap-3 rounded-xl border border-asphalt-800 bg-asphalt-900/50 p-2">
                <DriverPortrait id={d.id} name={d.name} look={d.look ?? {}} className="h-12 w-12" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{d.name}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {d.look?.cap && <ActionButton action={{ type: 'unequipLook', driverId: d.id, part: 'cap' }} className="btn-ghost px-2 py-0.5 text-[11px]">{t('Свали: {0}', tx(ITEMS.trucker_cap.name))}</ActionButton>}
                    {d.look?.glasses && <ActionButton action={{ type: 'unequipLook', driverId: d.id, part: 'glasses' }} className="btn-ghost px-2 py-0.5 text-[11px]">{t('Свали: {0}', tx(ITEMS.sunglasses.name))}</ActionButton>}
                    {d.look?.frame && <ActionButton action={{ type: 'unequipLook', driverId: d.id, part: 'frame' }} className="btn-ghost px-2 py-0.5 text-[11px]">{t('Свали: {0}', tx(ITEMS[FRAME_ITEMS[d.look.frame]].name))}</ActionButton>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-mist-400">{t('Свалената козметика се връща в инвентара.')}</p>
        </Card>
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
      {features.item_album ? (
        <Link href="/game/inventory/album" className="panel flex items-center gap-3 border-violet-500/40 p-4 transition hover:border-gold-400/60">
          <span className="flex -space-x-3">{COLLECTION.items.map((id) => <ItemArt key={id} id={id} className={`h-10 w-10 ${everFound.has(id) || have.has(id) ? '' : 'opacity-30 grayscale'}`} />)}</span>
          <span className="flex-1 text-sm font-semibold">{t('Албум с предмети — всички колекции и наградите им')}</span>
          <span className="text-gold-300">→</span>
        </Link>
      ) : (
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
      )}
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
