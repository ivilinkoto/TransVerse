'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { api } from '@/lib/client/api';
import {
  BOUND_ITEMS,
  GOLDEN_KEY,
  ITEMS,
  ITEM_IDS,
  RARITIES,
  RARITY_ORDER,
  SELL_DAY_CAP,
  SELL_PRICE,
  TRADE_RULES,
  caseOdds,
  coinsOf,
  collectionOf,
  craftUp,
  isCase,
  lookPart,
  sourcesOf,
  tradable,
  type CaseId,
  type DriverLook,
  type ItemId,
} from '@/lib/game/items';
import { dateTime } from '@/lib/format';
import { ItemArt } from './ItemArt';
import { DriverPortrait } from './DriverPortrait';
import { useFeature } from './Features';
import { CaseOpening, CaseResults } from '@/components/fx/CaseOpening';
import { GameWindow } from '@/components/gameui/GameWindow';
import { playSelect } from '@/lib/client/motion';
import { t, tx } from '@/i18n/t';

interface Target {
  id: string;
  label: string;
  /** Drivers only: what the portrait wears now. */
  look?: DriverLook;
}

/** 1.2.1: what the item card knows besides the items (only with the new inventory). */
export interface InventoryExtras {
  /** Items that came in since the inventory was last opened (НОВО). */
  fresh: ItemId[];
  /** Items ever found (for the collections). */
  found: ItemId[];
  /** Where and when each owned item first came. */
  provenance: Partial<Record<ItemId, { reason: string; at: string; serials?: number[] }>>;
  friends: { id: string; username: string }[];
  /** ТрансКоин from sales today. */
  soldToday: number;
  level: number;
}

const OPEN_ALL_MAX = 20;
const USE_MANY_MAX = 20;
/** Items that may be used several times in a row (their effect adds up). */
const REPEATABLE: ItemId[] = ['fuel_voucher', 'coin_pouch', 'driver_handbook', 'cargo_cover'];
const TIER = Object.fromEntries(RARITY_ORDER.map((r, i) => [r, i])) as Record<keyof typeof RARITIES, number>;

const KIND_LABELS = { consumable: 'Консуматив', cosmetic: 'Козметика', collectible: 'За колекция', case: 'Кейс', coins: 'ТрансКоин' } as const;
type Filter = 'all' | 'consumable' | 'cosmetic' | 'collectible' | 'case';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Всички' },
  { id: 'consumable', label: 'Консумативи' },
  { id: 'cosmetic', label: 'Козметика' },
  { id: 'collectible', label: 'Колекции' },
  { id: 'case', label: 'Кейсове' },
];
type Sort = 'rarity' | 'new' | 'qty' | 'name';
const SORTS: { id: Sort; label: string }[] = [
  { id: 'rarity', label: 'По рядкост' },
  { id: 'new', label: 'Първо новите' },
  { id: 'qty', label: 'По брой' },
  { id: 'name', label: 'По име' },
];

/** Where an item came from, in words (item_log reasons). */
const REASON_LABELS: Record<string, string> = {
  daily: 'Дневна награда',
  level: 'Ново ниво',
  big_run: 'Голям рейс',
  mystery: 'Тайният клиент',
  lost_cargo: 'Изгубена пратка',
  challenge: 'Предизвикателство',
  road_find: 'Находка по пътя',
  'find:winter': 'Зимна находка',
  'find:xmas': 'Коледна находка',
  'find:souvenir': 'Сувенир от курс',
  treasure: 'Карта на съкровището',
  weekly_chest: 'Седмичен сандък',
  company_chest: 'Фирмен сандък',
  gift_in: 'Подарък',
  trade_in: 'Размяна',
  trade_back: 'Върната размяна',
  unequip: 'Свален от портрет',
  admin: 'От екипа',
  promo: 'Промокод',
};
function reasonLabel(reason: string) {
  if (reason.startsWith('case:')) {
    const c = reason.slice(5);
    return c in ITEMS ? tx(ITEMS[c as ItemId].name) : t('Кейс');
  }
  if (reason.startsWith('craft:')) return t('Работилница');
  if (reason.startsWith('collection:')) return t('Награда за колекция');
  return tx(REASON_LABELS[reason] ?? reason);
}

/** How the item is used, in one line. */
function howTo(id: ItemId) {
  const d = ITEMS[id];
  if (d.kind === 'case') return t('Натисни „Отвори“ — рулетката показва какво се пада. Шансовете са по-долу.');
  if (d.kind === 'collectible') return t('Не се използва — пази го за колекцията в албума. Повторените може да продадеш или размениш.');
  if (d.kind === 'cosmetic') return t('Избери шофьор и натисни „Използвай“ — вижда се на портрета. Може да го свалиш и пак ще е в инвентара.');
  if (d.target === 'driver') return t('Избери шофьор и натисни „Използвай“.');
  if (d.target === 'vehicle') return t('Избери камион и натисни „Използвай“.');
  return t('Натисни „Използвай“ — действа веднага за цялата фирма.');
}

/** 1.2 / 1.2.1: the inventory — filters, the item card with everything about it, use, sell, give and trade. */
export function InventoryGrid({ items, drivers, vehicles, extras }: { items: { itemId: string; qty: number }[]; drivers: Target[]; vehicles: Target[]; extras?: InventoryExtras }) {
  const router = useRouter();
  const known = items.filter((i): i is { itemId: ItemId; qty: number } => i.itemId in ITEMS);
  const menu = useFeature('inventory_menu') && !!extras;
  const trading = useFeature('item_trade') && !!extras;
  const workshop = useFeature('workshop');
  const album = useFeature('item_album');
  const fresh = useMemo(() => new Set(extras?.fresh ?? []), [extras?.fresh]);
  // 1.2.1.1: only items the player found themselves count (presents and trades do not).
  const found = useMemo(() => new Set(extras?.found ?? []), [extras?.found]);
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('rarity');
  const shown = useMemo(() => {
    const list = known.filter((i) => filter === 'all' || ITEMS[i.itemId].kind === filter);
    const by: Record<Sort, (a: (typeof list)[number], b: (typeof list)[number]) => number> = {
      rarity: (a, b) => TIER[ITEMS[b.itemId].rarity] - TIER[ITEMS[a.itemId].rarity],
      new: (a, b) => Number(fresh.has(b.itemId)) - Number(fresh.has(a.itemId)) || TIER[ITEMS[b.itemId].rarity] - TIER[ITEMS[a.itemId].rarity],
      qty: (a, b) => b.qty - a.qty,
      name: (a, b) => tx(ITEMS[a.itemId].name).localeCompare(tx(ITEMS[b.itemId].name)),
    };
    return menu ? [...list].sort(by[sort]) : list;
  }, [known, filter, sort, fresh, menu]);

  const [open, setOpen] = useState<ItemId | null>(shown[0]?.itemId ?? known[0]?.itemId ?? null);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [won, setWon] = useState<ItemId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [panel, setPanel] = useState<'sell' | 'gift' | 'trade' | null>(null);
  const [sellQty, setSellQty] = useState(1);
  const [useQty, setUseQty] = useState(1);
  const [friend, setFriend] = useState('');
  const [message, setMessage] = useState('');
  const [partner, setPartner] = useState('');
  const [want, setWant] = useState<ItemId | ''>('');
  // 1.1.4.3: the roulette, „Отвори всички“ and the new look on the portrait.
  const fx = useFeature('game_fx');
  // 1.2.3.6 „Нов облик“: game slots, and the item card in a game window.
  const gameUi = useFeature('game_ui');
  const [cardOpen, setCardOpen] = useState(false);
  const [opening, setOpening] = useState<{ caseId: CaseId; result: ItemId | null; serial: number | null; error: string | null } | null>(null);
  const [results, setResults] = useState<ItemId[] | null>(null);
  const [dressed, setDressed] = useState<{ driver: Target; part: 'cap' | 'glasses' | 'frame' } | null>(null);
  const def = open ? ITEMS[open] : null;
  const qtyOf = (id: ItemId) => known.find((i) => i.itemId === id)?.qty ?? 0;
  const targets = def?.target === 'driver' ? drivers : def?.target === 'vehicle' ? vehicles : [];

  const select = (id: ItemId) => {
    setOpen(id);
    setCardOpen(true);
    if (gameUi) playSelect();
    setTarget('');
    setNote(null);
    setError(null);
    setWon(null);
    setDressed(null);
    setConfirming(false);
    setPanel(null);
    setSellQty(1);
    setUseQty(1);
  };
  const call = async <T,>(body: Record<string, unknown>, done: (r: T) => void) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      done(await api<T>('/api/game/action', body));
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const spin = async (caseId: CaseId) => {
    setOpening({ caseId, result: null, serial: null, error: null });
    try {
      const r = await api<{ item: ItemId; serial?: number | null }>('/api/game/action', { type: 'openCase', caseId });
      setOpening({ caseId, result: r.item, serial: r.serial ?? null, error: null });
      router.refresh();
    } catch (e) {
      setOpening({ caseId, result: null, serial: null, error: (e as Error).message });
    }
  };
  const closeOpening = () => {
    const got = opening?.result;
    setOpening(null);
    if (got) {
      // ТрансКоин go to the wallet: the case stays selected, with what it gave.
      if (!coinsOf(got)) setOpen(got);
      setWon(got);
    }
  };
  const openAll = async (caseId: CaseId) => {
    setBusy(true);
    setError(null);
    const got: ItemId[] = [];
    try {
      for (let i = 0; i < Math.min(qtyOf(caseId), OPEN_ALL_MAX); i++) {
        const r = await api<{ item: ItemId }>('/api/game/action', { type: 'openCase', caseId });
        got.push(r.item);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (got.length) setResults(got);
      router.refresh();
    }
  };
  const run = async () => {
    if (!open) return;
    // 1.2.1: an epic or legendary item is used only after a second tap.
    if (menu && !isCase(open) && TIER[ITEMS[open].rarity] >= TIER.epic && !confirming) return setConfirming(true);
    setConfirming(false);
    setBusy(true);
    setError(null);
    setNote(null);
    setWon(null);
    try {
      if (isCase(open) && fx) {
        setBusy(false);
        return void spin(open);
      }
      if (isCase(open)) {
        const r = await api<{ item: ItemId }>('/api/game/action', { type: 'openCase', caseId: open });
        if (!coinsOf(r.item)) setOpen(r.item);
        setWon(r.item);
      } else {
        const body: Record<string, unknown> = { type: 'useItem', itemId: open };
        if (def?.target === 'driver') body.driverId = target;
        if (def?.target === 'vehicle') body.vehicleId = target;
        // 1.2.1: „Използвай ×N“ — one by one, stops at the first refusal.
        const times = REPEATABLE.includes(open) ? Math.max(1, Math.min(useQty, qtyOf(open), USE_MANY_MAX)) : 1;
        let last = '';
        let done = 0;
        try {
          for (let i = 0; i < times; i++) {
            last = (await api<{ result: string }>('/api/game/action', body)).result;
            done++;
          }
        } finally {
          if (done) setNote(times > 1 ? t('Използвани: {0}. {1}', done, last) : last);
        }
        const part = lookPart(open);
        const driver = drivers.find((d) => d.id === target);
        if (fx && part && driver) setDressed({ driver: { ...driver, look: { ...driver.look, ...(part.part === 'frame' ? { frame: part.frame } : { [part.part]: true }) } }, part: part.part });
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!known.length) return null;
  const price = def ? SELL_PRICE[def.rarity] : 0;
  const spare = open && def ? Math.max(0, qtyOf(open) - (def.kind === 'collectible' ? 1 : 0)) : 0;
  const capLeft = Math.max(0, SELL_DAY_CAP - (extras?.soldToday ?? 0));
  const canSell = trading && open && tradable(open) && !isCase(open) && spare > 0;
  const canSwap = trading && open && tradable(open);
  const up = open ? craftUp(open) : null;
  const collection = open ? collectionOf(open) : undefined;
  const origin = open ? extras?.provenance[open] : undefined;
  const sources = open ? sourcesOf(open) : [];
  const cardBody = open && def ? (
    <>
            {gameUi ? (
              <div className="item-hero -mx-4 -mt-3 flex flex-col items-center px-4 pb-2 pt-4 text-center sm:-mx-5" style={{ '--slot': RARITIES[def.rarity].color } as React.CSSProperties}>
                <ItemArt id={won && !coinsOf(won) ? won : open} className="item-hero-art h-32 w-32 sm:h-36 sm:w-36" />
                <p className="mt-1 text-xs font-bold uppercase tracking-[0.18em]" style={{ color: RARITIES[def.rarity].color }}>{tx(RARITIES[def.rarity].label)}{menu && <span className="text-mist-400"> · {tx(KIND_LABELS[def.kind])}</span>}</p>
                {menu && <p className="num mt-0.5 text-xs text-mist-300">{t('Имаш: {0}', qtyOf(open))}</p>}
              </div>
            ) : (
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border-2 bg-asphalt-900 p-2" style={{ borderColor: RARITIES[def.rarity].color }}><ItemArt id={won && !coinsOf(won) ? won : open} className="h-20 w-20" /></div>
              <div className="min-w-0">
                <p className="font-display text-lg font-bold">{tx(def.name)}</p>
                <p className="text-xs font-semibold" style={{ color: RARITIES[def.rarity].color }}>{tx(RARITIES[def.rarity].label)}{menu && <span className="text-mist-400"> · {tx(KIND_LABELS[def.kind])}</span>}</p>
                {menu && <p className="num text-xs text-mist-400">{t('Имаш: {0}', qtyOf(open))}</p>}
              </div>
            </div>
            )}
            <p className="text-sm text-mist-200">{tx(def.effect)}</p>
            {menu && (
              <div className="space-y-2 rounded-xl border border-asphalt-800 bg-asphalt-900/50 p-3 text-xs">
                <p><span className="font-semibold text-mist-300">{t('Как се използва:')}</span> <span className="text-mist-400">{howTo(open)}</span></p>
                {sources.length > 0 && (
                  <div>
                    <p className="font-semibold text-mist-300">{t('Откъде се намира:')}</p>
                    <ul className="mt-1 space-y-0.5 text-mist-400">
                      {sources.map((s, i) => (
                        <li key={i} className="flex justify-between gap-2"><span>{s.arg ? t(s.source, tx(s.arg)) : tx(s.source)}</span>{s.percent != null && <span className="num">{s.percent}%</span>}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {collection && (
                  <div>
                    <p className="font-semibold text-mist-300">{t('Колекция „{0}“: {1}/{2}', tx(collection.name), collection.items.filter((x) => found.has(x)).length, collection.items.length)}</p>
                    <div className="mt-1 flex gap-1">
                      {collection.items.map((x) => <span key={x} title={found.has(x) ? tx(ITEMS[x].name) : '?'} className={found.has(x) ? '' : 'opacity-25 grayscale'}><ItemArt id={x} className="h-7 w-7" /></span>)}
                    </div>
                  </div>
                )}
                {origin && (
                  <p className="text-mist-400">
                    <span className="font-semibold text-mist-300">{t('Първо намерен:')}</span> {reasonLabel(origin.reason)} · {dateTime(new Date(origin.at))}
                    {origin.serials?.length ? <span className="ml-1 font-bold text-gold-300">{origin.serials.map((n) => t('#{0} от {1}', n, GOLDEN_KEY.total)).join(', ')}</span> : null}
                  </p>
                )}
                {BOUND_ITEMS.includes(open) && <p className="text-gold-300">{t('Остава при теб завинаги — не се продава, подарява или разменя.')}</p>}
              </div>
            )}
            {isCase(open) && (
              <div>
                <p className="label mb-1">{t('Какво може да има вътре')}</p>
                <ul className="space-y-1 text-xs">
                  {caseOdds(open).map((o) => (
                    <li key={o.item} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5"><ItemArt id={o.item} className="h-6 w-6" />{tx(ITEMS[o.item].name)}</span>
                      <span className="num text-mist-400">{o.percent}%</span>
                    </li>
                  ))}
                  {album && open === 'case_gold' && (
                    <li className="flex items-center justify-between gap-2 text-gold-300">
                      <span className="flex items-center gap-1.5"><ItemArt id="golden_key" className="h-6 w-6" />{t('Златен ключ (преди тегленето, докато има номера)')}</span>
                      <span className="num">{GOLDEN_KEY.goldCaseChance * 100}%</span>
                    </li>
                  )}
                </ul>
              </div>
            )}
            {targets.length > 0 && (
              <select className="input text-sm" value={target} onChange={(e) => setTarget(e.target.value)} aria-label={def.target === 'driver' ? t('Шофьор') : t('Камион')}>
                <option value="">{def.target === 'driver' ? t('— избери шофьор —') : t('— избери камион —')}</option>
                {targets.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            )}
            {menu && REPEATABLE.includes(open) && qtyOf(open) > 1 && (
              <label className="flex items-center justify-between gap-2 text-xs text-mist-300">
                {t('Колко наведнъж')}
                <input type="number" className="input w-20 py-1 text-sm" min={1} max={Math.min(qtyOf(open), USE_MANY_MAX)} value={useQty} onChange={(e) => setUseQty(Math.max(1, Math.min(Number(e.target.value) || 1, qtyOf(open), USE_MANY_MAX)))} />
              </label>
            )}
            {def.kind !== 'collectible' && (
              <button type="button" className={confirming ? 'btn-primary w-full bg-loss' : 'btn-primary w-full'} disabled={busy || (def.target !== 'none' && !target) || !known.some((i) => i.itemId === open)} onClick={run}>
                {busy ? '…' : isCase(open) ? t('Отвори') : confirming ? t('Сигурен ли си? Натисни пак') : useQty > 1 && REPEATABLE.includes(open) ? t('Използвай ×{0}', useQty) : t('Използвай')}
              </button>
            )}
            {confirming && <p className="text-xs text-amber-sig">{t('Това е {0} предмет — използва се веднъж.', tx(RARITIES[def.rarity].label).toLowerCase())}</p>}
            {isCase(open) && fx && qtyOf(open) > 1 && (
              <button type="button" className="btn-ghost w-full" disabled={busy} onClick={() => void openAll(open)}>
                {t('Отвори всички ({0})', Math.min(qtyOf(open), OPEN_ALL_MAX))}
              </button>
            )}
            {(canSell || canSwap || (workshop && menu && up)) && (
              <div className="flex flex-wrap gap-1.5">
                {canSell && <button type="button" className={`btn-ghost px-3 py-1 text-xs ${panel === 'sell' ? 'border-gold-400/60 text-gold-300' : ''}`} onClick={() => setPanel(panel === 'sell' ? null : 'sell')}>{t('Продай · {0} TC', price)}</button>}
                {canSwap && <button type="button" className={`btn-ghost px-3 py-1 text-xs ${panel === 'gift' ? 'border-gold-400/60 text-gold-300' : ''}`} onClick={() => setPanel(panel === 'gift' ? null : 'gift')}>{t('Подари')}</button>}
                {canSwap && <button type="button" className={`btn-ghost px-3 py-1 text-xs ${panel === 'trade' ? 'border-gold-400/60 text-gold-300' : ''}`} onClick={() => setPanel(panel === 'trade' ? null : 'trade')}>{t('Размени')}</button>}
                {workshop && menu && up && <Link href={`/game/inventory/workshop?item=${open}`} className="btn-ghost px-3 py-1 text-xs">{t('В работилницата')}</Link>}
              </div>
            )}
            {panel === 'sell' && canSell && (
              <div className="space-y-2 rounded-xl border border-gold-400/30 bg-gold-400/5 p-3 text-xs">
                <p className="text-mist-300">{def.kind === 'collectible' ? t('Един остава за албума. Продаваш от повторените: {0}.', spare) : t('Може да продадеш до {0}.', spare)} {t('Днес още {0} от {1} TC.', capLeft, SELL_DAY_CAP)}</p>
                <div className="flex items-center gap-2">
                  <input type="number" className="input w-20 py-1 text-sm" min={1} max={spare} value={sellQty} onChange={(e) => setSellQty(Math.max(1, Math.min(Number(e.target.value) || 1, spare)))} aria-label={t('Брой')} />
                  <button type="button" className="btn-primary flex-1 py-1.5 text-sm" disabled={busy || capLeft < price} onClick={() => void call<{ sold: number; coins: number }>({ type: 'sellItem', itemId: open, qty: sellQty }, (r) => { setNote(t('Продадени: {0} — +{1} ТрансКоин.', r.sold, r.coins)); setPanel(null); })}>
                    {t('Продай за {0} TC', Math.min(sellQty, Math.floor(capLeft / price)) * price)}
                  </button>
                </div>
              </div>
            )}
            {panel === 'gift' && canSwap && (
              <div className="space-y-2 rounded-xl border border-violet-500/40 bg-violet-600/10 p-3 text-xs">
                {extras!.friends.length ? (
                  <>
                    <select className="input text-sm" value={friend} onChange={(e) => setFriend(e.target.value)} aria-label={t('Приятел')}>
                      <option value="">{t('— избери приятел —')}</option>
                      {extras!.friends.map((f) => <option key={f.id} value={f.id}>{f.username}</option>)}
                    </select>
                    <input className="input text-sm" maxLength={TRADE_RULES.noteMax} placeholder={t('Бележка към подаръка (по избор)')} value={message} onChange={(e) => setMessage(e.target.value)} />
                    <button type="button" className="btn-primary w-full py-1.5 text-sm" disabled={busy || !friend} onClick={() => void call({ type: 'giftItem', itemId: open, toUserId: friend, note: message || undefined }, () => { setNote(t('🎁 Подаръкът е опакован и изпратен.')); setPanel(null); setMessage(''); })}>{t('Опаковай и изпрати')}</button>
                  </>
                ) : (
                  <p className="text-mist-400">{t('Подаръци се пращат на приятели. Добави приятели от профила си.')}</p>
                )}
              </div>
            )}
            {panel === 'trade' && canSwap && (
              <div className="space-y-2 rounded-xl border border-cyan-glow/30 bg-cyan-glow/5 p-3 text-xs">
                {(extras?.level ?? 0) < TRADE_RULES.minLevel ? (
                  <p className="text-mist-400">{t('Размените са за играчи от ниво {0}.', TRADE_RULES.minLevel)}</p>
                ) : (
                  <>
                    <p className="text-mist-400">{t('Даваш 1 × {0}. Предметът се пази, докато играчът отговори.', tx(def.name))}</p>
                    <input className="input text-sm" placeholder={t('Име на играча')} value={partner} onChange={(e) => setPartner(e.target.value)} />
                    <select className="input text-sm" value={want} onChange={(e) => setWant(e.target.value as ItemId)} aria-label={t('Искаш в замяна')}>
                      <option value="">{t('— какво искаш в замяна —')}</option>
                      {ITEM_IDS.filter((x) => x !== open && tradable(x) && ITEMS[x].kind !== 'coins').map((x) => <option key={x} value={x}>{tx(ITEMS[x].name)} · {tx(RARITIES[ITEMS[x].rarity].label)}</option>)}
                    </select>
                    <input className="input text-sm" maxLength={TRADE_RULES.noteMax} placeholder={t('Бележка (по избор)')} value={message} onChange={(e) => setMessage(e.target.value)} />
                    <button type="button" className="btn-primary w-full py-1.5 text-sm" disabled={busy || !partner.trim() || !want} onClick={() => void call({ type: 'offerTrade', toUsername: partner.trim(), give: open, want, note: message || undefined }, () => { setNote(t('🔁 Предложението е изпратено.')); setPanel(null); setMessage(''); })}>{t('Предложи размяна')}</button>
                  </>
                )}
              </div>
            )}
            {dressed && (
              <div className="flex items-center gap-3 rounded-xl border border-asphalt-700 bg-asphalt-900/60 p-2">
                <DriverPortrait id={dressed.driver.id} name={dressed.driver.label} look={dressed.driver.look} fresh={dressed.part} className="h-16 w-16" />
                <span className="text-sm">{dressed.driver.label}</span>
              </div>
            )}
            {won && <p role="status" className="rounded-xl border border-gold-400/40 bg-gold-400/10 p-2 text-sm font-semibold text-gold-400">{t('🎉 Падна ти: {0}!', tx(ITEMS[won].name))}</p>}
            {note && <p role="status" className="text-sm text-profit">{note}</p>}
            {error && <p role="alert" className="text-sm text-loss">{error}</p>}
    </>
  ) : null;
  return (
    <div className="space-y-3">
      {menu && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t('Вид предмети')}>
            {FILTERS.map((f) => {
              const n = f.id === 'all' ? known.length : known.filter((i) => ITEMS[i.itemId].kind === f.id).length;
              return (
                <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)} className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${filter === f.id ? 'border-gold-400/70 bg-violet-600/30 text-gold-300' : 'border-asphalt-700 text-mist-400 hover:text-white'}`}>
                  {tx(f.label)} <span className="num opacity-70">{n}</span>
                </button>
              );
            })}
          </div>
          <select className="input w-auto py-1 text-xs" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={t('Подреди')}>
            {SORTS.map((s) => <option key={s.id} value={s.id}>{tx(s.label)}</option>)}
          </select>
        </div>
      )}
      <div className={gameUi ? '' : 'grid gap-4 lg:grid-cols-[1fr_360px]'}>
        <ul className={`grid content-start gap-2 ${gameUi ? 'grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 sm:gap-2.5' : 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6'}`} data-testid="inventory-grid">
          {shown.map((i) => {
            const d = ITEMS[i.itemId];
            if (gameUi)
              return (
                <li key={i.itemId}>
                  <button type="button" onClick={() => select(i.itemId)} aria-pressed={cardOpen && open === i.itemId} title={tx(d.name)} className={`slot slot-${d.rarity} flex w-full flex-col items-center justify-center p-1.5`} style={{ '--slot': RARITIES[d.rarity].color } as React.CSSProperties}>
                    <ItemArt id={i.itemId} className="slot-art h-[62%] w-[62%]" />
                    <span className="mt-0.5 line-clamp-1 w-full px-1 text-center text-[10px] font-semibold leading-tight text-mist-100">{tx(d.name)}</span>
                    {i.qty > 1 && <span className="slot-qty num">×{i.qty}</span>}
                    {menu && fresh.has(i.itemId) && <span className="slot-new">{t('НОВО')}</span>}
                  </button>
                </li>
              );
            return (
              <li key={i.itemId}>
                <button type="button" onClick={() => select(i.itemId)} aria-pressed={open === i.itemId} className={`relative flex w-full flex-col items-center gap-1 rounded-2xl border-2 bg-asphalt-850 p-2 text-center transition hover:-translate-y-0.5 ${open === i.itemId ? 'ring-2 ring-white/40' : ''}`} style={{ borderColor: RARITIES[d.rarity].color }}>
                  <ItemArt id={i.itemId} className="h-14 w-14 sm:h-16 sm:w-16" />
                  <span className="line-clamp-2 text-[11px] font-medium leading-tight">{tx(d.name)}</span>
                  {i.qty > 1 && <span className="num absolute right-1.5 top-1.5 rounded-full bg-asphalt-950/90 px-1.5 text-[11px] font-bold">×{i.qty}</span>}
                  {menu && fresh.has(i.itemId) && <span className="absolute left-1.5 top-1.5 rounded-full bg-gold-400 px-1.5 text-[9px] font-black uppercase leading-4 text-asphalt-950">{t('НОВО')}</span>}
                </button>
              </li>
            );
          })}
          {!shown.length && <li className="col-span-full py-6 text-center text-sm text-mist-400">{t('Няма предмети от този вид.')}</li>}
          {/* Empty cells fill the bag up to full rows. */}
          {gameUi && Array.from({ length: Math.max(0, Math.max(16, Math.ceil(shown.length / 8) * 8) - shown.length) }, (_, k) => <li key={`e${k}`} aria-hidden className="slot-empty" />)}
        </ul>
        {open && def && !gameUi && (
          <aside className="panel h-fit space-y-3 p-4 lg:sticky lg:top-24" data-testid="item-card">
            {cardBody}
          </aside>
        )}
        {open && def && gameUi && cardOpen && (
          <GameWindow title={tx(def.name)} icon="🎒" accent={RARITIES[def.rarity].color} size="sm" onClose={() => setCardOpen(false)} testId="item-window">
            <div className="space-y-3" data-testid="item-card">{cardBody}</div>
          </GameWindow>
        )}
      </div>
      {opening && <CaseOpening caseId={opening.caseId} result={opening.result} serial={opening.serial} error={opening.error} left={opening.result ? qtyOf(opening.caseId) : 0} onAgain={() => void spin(opening.caseId)} onClose={closeOpening} skippable={menu} />}
      {results && <CaseResults results={results} onClose={() => setResults(null)} />}
    </div>
  );
}
