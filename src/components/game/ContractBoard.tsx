'use client';

import { AlertTriangle, ArrowRight, BadgeCheck, Boxes, Clock, Lock, MapPinned, Route, Search, Ship, ShieldCheck, Hammer, House, Siren, Snowflake, Star, TrainFront, Truck } from 'lucide-react';
import { ChristmasTreeIcon, PumpkinIcon } from '@/components/seasonal/icons';
import { HALLOWEEN } from '@/lib/game/halloween';
import { CHRISTMAS } from '@/lib/game/christmas';
import { WINTER } from '@/lib/game/winter';
import { CONVOY_RULES } from '@/lib/game/convoy';
import { RELAY, relayLabel } from '@/lib/game/relay';
import { PLOT } from '@/lib/game/plot';
import { MULTISTOP } from '@/lib/game/multistop';
import { DAILY_LOAD, SHARED_LOAD } from '@/lib/game/together';
import { HireDialog } from './HireDialog';
import { fixFor, WhyNot } from './WhyNot';
import { Term } from './Term';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Children, useEffect, useMemo, useState } from 'react';
import { Badge, Empty, type BadgeTone } from '@/components/ui';
import { api } from '@/lib/client/api';
import { dateTime, dec, duration, int, km, money } from '@/lib/format';
import type { CargoType } from '@/lib/game/cargo';
import { MARTA } from '@/lib/game/marta';
import { HAGGLE, SEALED } from '@/lib/game/deals';
import { RELIEF } from '@/lib/game/relief';
import { CARGO_INSURANCE } from '@/lib/game/roads';
import { useFeature } from './Features';
import { NATIONAL_DAY, SOWING } from '@/lib/game/spring';
import { HARVEST } from '@/lib/game/city-growth';
import { SECURE_PARKING } from '@/lib/game/traffic';
import { SPECIALIZATION } from '@/lib/game/specialization';
import { TRANS_EUROPE } from '@/lib/game/europe';
import { t, tx, intlLocale } from '@/i18n/t';

export interface BoardContract {
  id: string;
  /** Trucks on this lane right now (v1.6; 0 below the traffic threshold). */
  traffic?: number;
  /** The cargo of the company's specialisation (v1.7 on the board). */
  specialization?: boolean;
  /** Low-emission zones at the ends (v1.7). */
  lez?: string[];
  /** 2 500 km and more, for a two-driver crew (v1.7). */
  transEurope?: boolean;
  shipper: string;
  goods: string;
  cargoType: CargoType;
  cargoLabel: string;
  /** v1.8: the shipper does not say what is inside. */
  sealed?: boolean;
  /** v1.8: relief goods for a humanitarian convoy. */
  humanitarian?: boolean;
  /** v1.10: a leg of a relay load (1 or 2). */
  relayLeg?: number | null;
  /** v1.10: the temperature range of a refrigerated load. */
  temp?: string | null;
  /** v1.8: haggling: 'open' (may ask), the player's ask, or null (not for this load). */
  haggle?: 'open' | { percent: number; accepted: boolean; holdUntil: string; valid: boolean } | null;
  /** What a vehicle needs to take this load (shown above the vehicle list). */
  needs: { bodies: string[]; level: number };
  tons: number;
  origin: { id: number; name: string; country: string };
  destination: { id: number; name: string; country: string };
  distanceKm: number;
  provider: string;
  hasToll: boolean;
  borders: number;
  countries: string[];
  rewardCents: number;
  windowMinutes: number;
  expiresAt: string;
  /** Minutes until the offer leaves the board, computed by the server at render time. */
  expiresInMin: number;
  minLevel: number;
  locked: boolean;
  /** Premium contract: reputation needed (0 = ordinary). */
  minReputation: number;
  /** The player's reputation is below what this premium contract needs. */
  reputationLocked: boolean;
  /** Starts in a city where one of the player's free vehicles stands. */
  local: boolean;
  /** Urgent shipment from the game administration: listed first, driven faster. */
  urgent: boolean;
  /** Holiday load ('halloween'): themed goods, better pay. */
  holiday: string | null;
  /** Winter: the worst road condition on the way today (null when the roads are clear). */
  weather: { condition: 'snow' | 'ice' | 'blizzard'; label: string; country: string } | null;
  /** Counts for the running project of the player's company (its cargo to its city). */
  project: string | null;
  /** A company handed this load to the player (held for them, commission on delivery). */
  hiredBy: { offerId: string; company: string; share: number; until: string } | null;
  /** A friend or company member left on this lane in the last half hour: taking it forms a convoy. */
  convoy: string | null;
  /** Goes to the player's base (HQ). */
  toHome: boolean;
  /** Groupage: drops on the way before the destination (empty for an ordinary load). */
  stops: { name: string; country: string; tons: number; windowMinutes: number }[];
  /** Building materials for the player's company plot (members only). */
  construction: boolean;
  /** The last load a construction waits for (paid more). */
  lastLoad?: boolean;
  /** The player starred this lane (origin → destination). */
  favorite: boolean;
  /** Load of a tender of the player's company (only members see it). */
  tender: boolean;
  /** "Товар на деня" (v1.3). */
  featured?: boolean;
  /** A load a member shared with the player's company (v1.3). */
  shared?: boolean;
  /** The player may share it with the company. */
  canShare?: boolean;
  /** v1.4: a ferry on the way (islands), a container from a port, trains the truck may ride. */
  ferry?: { note: string; ticketCents: number } | null;
  port?: string | null;
  rail?: { id: string; note: string; ticketCents: number; km: number; kind?: 'rail' | 'ferry'; hours?: number }[];
  /** Someone's own goods on the freight exchange (the shipper's label). */
  exchange?: string | null;
  /** Oversize load (v1.5): what the permit and the escort cost. */
  oversizeCents?: number | null;
  /** Road works on the way (v1.5). */
  roadWorks?: string | null;
  /** An urgent shipment nobody took: its pay went up this many times by 10 % (v1.5). */
  urgentRaises?: number;
  /** The player's own weekly rally run (v1.4). */
  rally?: boolean;
  speedFactor: number;
  /** Urgent shipment this player has already taken (each player may take it once). */
  alreadyTaken: boolean;
  /** VIP reservation (time shown as HH:MM). */
  reservedByMe: boolean;
  reservedByOther: boolean;
  reservedUntil: string | null;
  /** Urgent shipment not yet open for this (non-VIP) player — opens at HH:MM. */
  opensAt: string | null;
  /** Short names of licences the player still needs for this contract. */
  missingLicences: string[];
  options: {
    vehicleId: string;
    label: string;
    error: string | null;
    emptyKm: number;
    costCents: number;
    rented: boolean;
    profitCents: number;
    minutes: number;
    /** Trip time if the tired crew drives on without the due rest (null when rested). */
    rushMinutes: number | null;
    /** > 0 when the load fits only with an overload (percent over the payload). */
    overloadPercent: number;
    /** The load is bigger than the truck: the part it can take and its pay (null when it fits or may not be split). */
    part: { tons: number; rewardCents: number } | null;
  }[];
}

const CARGO_TONE: Record<CargoType, BadgeTone> = { pallets: 'blue', refrigerated: 'cyan', bulk: 'orange', container: 'gold', liquid: 'red', special: 'violet', steel: 'neutral', vehicles: 'green' };

type Sort = 'reward' | 'perKm' | 'distance' | 'expires';
type Chip = 'fav' | 'home' | 'hired' | 'stops' | 'halloween' | 'christmas' | 'marta' | 'sowing' | 'harvest' | 'national' | 'oversize' | 'winter' | 'clear' | 'licence' | 'fast' | 'perKm';

const CHIPS: { id: Chip; label: string; test: (c: BoardContract) => boolean }[] = [
  { id: 'fav', label: '★ Любими линии', test: (c) => c.favorite },
  { id: 'home', label: 'Към базата', test: (c) => c.toHome },
  { id: 'hired', label: 'Възложени на мен', test: (c) => !!c.hiredBy },
  { id: 'stops', label: 'Сборни товари', test: (c) => c.stops.length > 0 },
  { id: 'halloween', label: 'Хелуин', test: (c) => c.holiday === 'halloween' },
  { id: 'christmas', label: 'Коледа', test: (c) => c.holiday === 'christmas' },
  { id: 'marta', label: 'Баба Марта', test: (c) => c.holiday === 'marta' },
  { id: 'sowing', label: '🌱 Сеитба', test: (c) => c.holiday === 'sowing' },
  { id: 'harvest', label: '🍇 Гроздобер', test: (c) => c.holiday === 'harvest' },
  { id: 'national', label: '🎉 Национален празник', test: (c) => c.holiday === 'national' },
  { id: 'oversize', label: 'Извънгабаритни', test: (c) => !!c.oversizeCents },
  { id: 'winter', label: '❄ Зимни товари', test: (c) => c.holiday === 'winter' },
  { id: 'clear', label: 'Без сняг по пътя', test: (c) => !c.weather },
  { id: 'licence', label: 'Без нужда от лиценз', test: (c) => c.missingLicences.length === 0 },
  { id: 'fast', label: 'До 2 часа', test: (c) => c.options.some((o) => !o.error && o.minutes <= 120) },
  { id: 'perKm', label: 'Над 3 лв./км', test: (c) => c.rewardCents / c.distanceKm >= 300 },
];

/** Chips that appear only in their season (when some contract matches). */
const SEASONAL_CHIPS = new Map<Chip, (c: BoardContract) => boolean>([
  ['home', (c) => c.toHome],
  ['hired', (c) => !!c.hiredBy],
  ['stops', (c) => c.stops.length > 0],
  ['halloween', (c) => c.holiday === 'halloween'],
  ['christmas', (c) => c.holiday === 'christmas'],
  ['marta', (c) => c.holiday === 'marta'],
  ['sowing', (c) => c.holiday === 'sowing'],
  ['harvest', (c) => c.holiday === 'harvest'],
  ['national', (c) => c.holiday === 'national'],
  ['oversize', (c) => !!c.oversizeCents],
  ['winter', (c) => c.holiday === 'winter'],
  ['clear', (c) => !!c.weather],
]);

/** `doableDefault` (1.1.3): new players start with "Само изпълними" on. */
export function ContractBoard({ contracts, cargoTypes, localCityNames, vip = false, initialChips = [], canAssign = false, focus, simple = false, doableDefault = false }: { contracts: BoardContract[]; cargoTypes: { id: string; label: string }[]; localCityNames: string[]; vip?: boolean; initialChips?: Chip[]; canAssign?: boolean; focus?: string; simple?: boolean; doableDefault?: boolean }) {
  const [chips, setChips] = useState<Set<Chip>>(() => new Set(initialChips));
  const toggleChip = (id: Chip) => setChips((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const [cargo, setCargo] = useState<string>('');
  const [query, setQuery] = useState('');
  const [doable, setDoable] = useState(doableDefault);
  const [sort, setSort] = useState<Sort>('reward');
  // A link to one load (a notification, Discord) opens it first.
  const [open, setOpen] = useState<string | null>(() => (focus && contracts.some((c) => c.id === focus) ? focus : null));
  // After accepting, the player stays on the board; a short note says where the truck went.
  const [sent, setSent] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  // VIP: saved board filters (kept in this browser).
  useEffect(() => {
    if (!vip) return;
    try {
      const raw = localStorage.getItem('tv:board-filter');
      if (!raw) return;
      const f = JSON.parse(raw) as { cargo?: string; query?: string; doable?: boolean; sort?: Sort };
      /* eslint-disable react-hooks/set-state-in-effect -- one-time restore from storage */
      if (f.cargo !== undefined) setCargo(f.cargo);
      if (f.query !== undefined) setQuery(f.query);
      if (f.doable !== undefined) setDoable(f.doable);
      if (f.sort) setSort(f.sort);
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {
      /* storage unavailable */
    }
  }, [vip]);
  const saveFilter = () => {
    try {
      localStorage.setItem('tv:board-filter', JSON.stringify({ cargo, query, doable, sort }));
      setSavedNote(t('Филтърът е запазен.'));
    } catch {
      setSavedNote(t('Браузърът не позволява запазване.'));
    }
  };

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = contracts.filter(
      (c) =>
        (!cargo || c.cargoType === cargo) &&
        (!q || c.origin.name.toLowerCase().includes(q) || c.destination.name.toLowerCase().includes(q) || c.goods.toLowerCase().includes(q)) &&
        (!doable || (!c.locked && !c.reputationLocked && !c.alreadyTaken && !c.reservedByOther && !c.opensAt && !c.missingLicences.length && c.options.some((o) => !o.error))) &&
        CHIPS.every((chip) => !chips.has(chip.id) || chip.test(c)),
    );
    const key: Record<Sort, (c: BoardContract) => number> = {
      reward: (c) => -c.rewardCents,
      perKm: (c) => -c.rewardCents / c.distanceKm,
      distance: (c) => c.distanceKm,
      expires: (c) => new Date(c.expiresAt).getTime(),
    };
    const takeable = (c: BoardContract) => !c.locked && !c.reputationLocked && !c.alreadyTaken && !c.reservedByOther && !c.opensAt && !c.missingLicences.length && c.options.some((o) => !o.error);
    // 1.1.2: what a free truck can take right where it stands comes first, always;
    // then the load of the day, urgent shipments, favourite lanes and the rest.
    const rank = (c: BoardContract) => (c.id === focus ? -1 : c.local && takeable(c) ? 0 : c.featured ? 1 : c.urgent ? 2 : (c.shared || c.favorite || c.tender) && takeable(c) ? 3 : takeable(c) ? 4 : c.local ? 5 : 6);
    return filtered.sort((a, b) => rank(a) - rank(b) || key[sort](a) - key[sort](b));
  }, [contracts, cargo, query, doable, sort, chips, focus]);

  // 1.1.2: with "Само изпълними" and nothing left, the most common reasons why.
  const blockers = useMemo(() => {
    if (!doable || list.length) return [];
    const counts = new Map<string, number>();
    for (const c of contracts) {
      const why = whyNot(c);
      if (why) counts.set(why, (counts.get(why) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3);
  }, [contracts, doable, list.length]);

  return (
    <div className="space-y-4">
      {sent && (
        <div role="status" className="sticky top-16 z-20 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-profit/40 bg-asphalt-900/95 px-4 py-3 text-sm shadow-lg backdrop-blur lg:top-20">
          <Truck className="h-4 w-4 shrink-0 text-profit" />
          <span className="min-w-0 flex-1 basis-[calc(100%-2rem)] sm:basis-auto">{sent}</span>
          <Link href="/game/fleet" className="text-cyan-glow hover:underline">{t('Автопарк')}</Link>
          <Link href="/game/map" className="text-cyan-glow hover:underline">{t('Карта')}</Link>
          <button type="button" className="text-mist-400 hover:text-white" onClick={() => setSent(null)} aria-label={t('Скрий')}>✕</button>
        </div>
      )}
      <div className="panel flex flex-wrap items-center gap-3 p-3">
        <label className="relative w-full min-w-[200px] flex-1 sm:w-auto">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mist-400" />
          <input className="input pl-9" placeholder={t('Град или стока…')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('Търсене')} />
        </label>
        <select className="input w-[calc(50%-0.375rem)] text-sm sm:w-auto" value={cargo} onChange={(e) => setCargo(e.target.value)} aria-label={t('Вид товар')}>
          <option value="">{t('Всички товари')}</option>
          {cargoTypes.map((c) => <option key={c.id} value={c.id}>{tx(c.label)}</option>)}
        </select>
        <select className="input w-[calc(50%-0.375rem)] text-sm sm:w-auto" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={t('Подреждане')}>
          <option value="reward">{t('Най-доходни')}</option>
          <option value="perKm">{t('Най-добре на км')}</option>
          <option value="distance">{t('Най-къси')}</option>
          <option value="expires">{t('Изтичат скоро')}</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-mist-300">
          <input type="checkbox" checked={doable} onChange={(e) => setDoable(e.target.checked)} className="h-4 w-4 accent-cyan-500" />
          {t('Само изпълними с моя автопарк')}
        </label>
        {vip && (
          <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={saveFilter} title={t('VIP: запомни тези филтри')}>
            {t('Запази филтъра{0}', savedNote ? ' ✓' : '')}
          </button>
        )}
        <span className="num ml-auto text-xs text-mist-400">{t('{0} от {1}', list.length, contracts.length)}</span>
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label={t('Бързи филтри')}>
        {CHIPS.filter((chip) => !SEASONAL_CHIPS.has(chip.id) || contracts.some(SEASONAL_CHIPS.get(chip.id)!)).map((chip) => (
          <button key={chip.id} type="button" aria-pressed={chips.has(chip.id)} onClick={() => toggleChip(chip.id)} className={`shrink-0 rounded-full border px-3 py-1.5 text-sm transition ${chips.has(chip.id) ? 'border-volt-500 bg-volt-500/20 text-white' : 'border-asphalt-700 text-mist-300 hover:text-white'}`}>
            {tx(chip.label)}
          </button>
        ))}
      </div>
      {localCityNames.length > 0 && (
        <p className="flex items-center gap-2 text-sm text-mist-300">
          <MapPinned className="h-4 w-4 text-gold-400" />
          {t('Първо са поръчките от {0} — там те чака свободен камион.', localCityNames.join(', '))}
        </p>
      )}
      {list.length === 0 ? (
        <>
          <Empty icon={Truck} title={t('Няма поръчки по тези критерии')}>{t('Пазарът се обновява на всеки няколко минути.')}</Empty>
          {doable && blockers.length > 0 && (
            <div className="rounded-2xl border border-amber-sig/40 bg-amber-sig/5 p-4 text-sm">
              <div className="font-semibold text-amber-sig">{t('Защо нито една поръчка не е изпълнима')}</div>
              <ul className="mt-2 space-y-2">
                {blockers.map(([why, n]) => {
                  const fix = fixFor(why);
                  return (
                    <li key={why}>
                      <div><AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-amber-sig" />{tx(why)} <span className="text-xs text-mist-400">{t('· {0} поръчки', n)}</span></div>
                      {fix && <Link href={fix.href} className="mt-0.5 block text-xs text-cyan-glow hover:underline">{tx(fix.text)} →</Link>}
                    </li>
                  );
                })}
              </ul>
              <button type="button" className="btn-ghost mt-3 px-3 py-1.5 text-xs" onClick={() => setDoable(false)}>{t('Покажи всички поръчки')}</button>
            </div>
          )}
        </>
      ) : (
        <ul className="space-y-2">
          {list.map((c) => (
            <ContractRow key={c.id} contract={c} vip={vip} simple={simple} canAssign={canAssign} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} onAccepted={(text) => { setSent(text); setOpen(null); }} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** v1.9: in the simple board the extra tags of a load fold into one "⭐ N бонуса" chip. */
function Bonuses({ simple, children }: { simple: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const items = Children.toArray(children);
  if (!simple || items.length <= 1 || open) return <>{items}</>;
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setOpen(true); } }}
      className="rounded-full border border-gold-400/40 bg-gold-400/10 px-2 py-0.5 text-[11px] font-semibold text-gold-400"
      title={t('Покажи етикетите')}
    >
      ⭐ {tx(items.length)} {items.length === 1 ? t('етикет') : t('етикета')} ▾
    </span>
  );
}

/** v1.8: ask the shipper for more (once); a "no" gives the load to someone else. */
function HaggleBox({ contractId, rewardCents, haggle }: { contractId: string; rewardCents: number; haggle: NonNullable<BoardContract['haggle']> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  if (haggle !== 'open') {
    return haggle.valid ? (
      <p className="rounded-xl border border-profit/40 bg-profit/10 p-3 text-sm">{t('🤝 Клиентът прие +{0}% (+{1}) — важи, ако приемеш поръчката до {2}.', haggle.percent, money(Math.round((rewardCents * haggle.percent) / 100)), new Date(haggle.holdUntil).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' }))}</p>
    ) : (
      <p className="rounded-xl border border-asphalt-600 p-3 text-sm text-mist-400">{t('🤝 Договореното +{0}% изтече — поръчката е на обичайната цена.', haggle.percent)}</p>
    );
  }
  const ask = async (percent: number) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ accepted: boolean; percent: number }>('/api/game/action', { type: 'haggle', contractId, percent });
      setAnswer(r.accepted ? t('Клиентът прие +{0}%!', r.percent) : t('Клиентът отказа и даде товара на друг.'));
      setTimeout(() => router.refresh(), 1500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-xl border border-gold-400/30 bg-gold-400/5 p-3 text-sm">
      <div className="font-semibold text-gold-400">{t('🤝 Пазарлък с клиента')}</div>
      <p className="mt-1 text-mist-300">{t('Може да поискаш повече веднъж. Колкото повече искаш, толкова по-вероятно е „не“ — и тогава товарът отива при друг.')}</p>
      {answer ? (
        <p className="mt-2 font-semibold">{answer}</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {HAGGLE.asks.map((a) => (
            <button key={a.percent} type="button" className="btn-ghost px-3 py-1.5 text-xs" disabled={busy} onClick={() => void ask(a.percent)}>
              {t('+{0}% (+{1}) · шанс ~{2}%', a.percent, money(Math.round((rewardCents * a.percent) / 100)), Math.round(a.chance * 100))}
            </button>
          ))}
        </div>
      )}
      {error && <p role="alert" className="mt-1 text-loss">{error}</p>}
    </div>
  );
}

/** 1.1.2: the one reason the player cannot take this load right now (null when they can). */
function whyNot(c: BoardContract): string | null {
  if (c.alreadyTaken) return null;
  if (c.locked) return t('Изисква ниво {0}.', c.minLevel);
  if (c.reputationLocked) return t('Изисква репутация {0}.', c.minReputation);
  if (c.missingLicences.length) return t('Липсва лиценз: {0}.', c.missingLicences.map((l) => tx(l)).join(', '));
  if (c.reservedByOther) return t('Запазена е от друга компания до {0}.', c.reservedUntil ?? '');
  if (c.opensAt) return t('Отваря се за всички в {0} (VIP я виждат по-рано).', c.opensAt);
  if (!c.options.length) return t('Нямаш превозно средство.');
  if (c.options.some((o) => !o.error)) return null;
  // The reason of the truck nearest to the load.
  return [...c.options].sort((a, b) => a.emptyKm - b.emptyKm)[0]!.error;
}

function ContractRow({ contract: c, vip, simple, canAssign, open, onToggle, onAccepted }: { contract: BoardContract; vip: boolean; simple: boolean; canAssign: boolean; open: boolean; onToggle: () => void; onAccepted: (text: string) => void }) {
  const [hiring, setHiring] = useState(false);
  const router = useRouter();
  const usable = c.options.filter((o) => !o.error);
  const blocked = c.options.filter((o) => o.error);
  // The reasons, each once, with the vehicles it stops (the plate is the label's first part).
  const canSplitHint = c.options.some((o) => o.part);
  const [vehicleId, setVehicleId] = useState(usable[0]?.vehicleId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const option = c.options.find((o) => o.vehicleId === vehicleId);
  const reason = whyNot(c);
  const [rush, setRush] = useState(false);
  const [overload, setOverload] = useState(false);
  const [insure, setInsure] = useState(false);
  const insuranceLive = useFeature('cargo_insurance');
  const routeChoice = useFeature('route_choice');
  const [cheap, setCheap] = useState(false);
  const parkingLive = useFeature('secure_parking');
  const [secure, setSecure] = useState(false);
  const refuelLive = useFeature('refuel');
  const [refuel, setRefuel] = useState(false);
  const [rail, setRail] = useState('');
  const needsOverload = !!option && option.overloadPercent > 0;
  // A load bigger than the truck goes as a part, unless the player chose to overload and take it all.
  const part = option?.part && !(needsOverload && overload) ? option.part : null;
  // The page estimates a part's profit; overloading the whole load is paid in full.
  const shownProfit = option ? (option.part && !part ? option.profitCents + c.rewardCents - option.part.rewardCents : option.profitCents) : 0;
  const shownMinutes = option ? (rush && option.rushMinutes != null ? option.rushMinutes : option.minutes) : 0;

  const [favBusy, setFavBusy] = useState(false);
  const toggleFavorite = async () => {
    setFavBusy(true);
    try {
      await api('/api/game/action', { type: 'favoriteLane', originCityId: c.origin.id, destCityId: c.destination.id });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFavBusy(false);
    }
  };

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/game/action', { type: 'acceptContract', contractId: c.id, vehicleId, rush: rush && option?.rushMinutes != null, overload: needsOverload && overload, ...(part ? { tons: part.tons } : {}), ...(rail ? { rail } : {}), insure: insuranceLive && insure, route: routeChoice && cheap && !rail ? 'cheap' : 'fast', parking: parkingLive && secure ? 'secure' : 'free', refuel: refuelLive && refuel });
      onAccepted(t('Камионът тръгна: {0}{1}, {2} → {3}. Можеш да поемеш следващата поръчка.', part ? t('{0} т ', dec(part.tons)) : '', c.goods, c.origin.name, c.destination.name));
      setBusy(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <li className={`panel overflow-hidden transition ${open ? 'border-volt-500/60' : c.urgent ? 'border-loss/60 hover:border-loss' : c.local ? 'border-gold-400/40 hover:border-gold-400/70' : 'hover:border-asphalt-500'} ${c.locked || c.reputationLocked || c.missingLicences.length ? 'opacity-60' : ''}`}>
      <button className="grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 p-4 text-left sm:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_auto]" onClick={onToggle} aria-expanded={open}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={CARGO_TONE[c.cargoType]}>{tx(c.cargoLabel)}</Badge>
            <span className="truncate font-semibold">{tx(c.goods)}</span>
            <span className="num text-sm text-mist-400">{t('{0} т', dec(c.tons))}</span>
            {c.urgent && <Badge tone="red"><Siren className="h-3 w-3" />{t('СПЕШНО · ×{0} по-бързо · до товара за 1 мин', dec(c.speedFactor))}</Badge>}
            {c.missingLicences.length > 0 && <Badge tone="orange"><BadgeCheck className="h-3 w-3" />{t('Лиценз: {0}', c.missingLicences.map((l) => tx(l)).join(', '))}</Badge>}
            {c.locked && <Badge tone="violet"><Lock className="h-3 w-3" />{t('ниво {0}', c.minLevel)}</Badge>}
            <Bonuses simple={simple}>
              {c.tender && <Badge tone="violet">{t('ТЪРГ НА КОМПАНИЯТА')}</Badge>}
              {c.exchange && <Badge tone="violet">{t('БОРСА МЕЖДУ ИГРАЧИ')}</Badge>}
              {c.rally && <Badge tone="orange">{t('🏁 РАЛИ — мери се времето и горивото')}</Badge>}
              {c.ferry && <Badge tone="cyan"><Ship className="h-3 w-3" />{c.ferry.note.toUpperCase()}</Badge>}
              {c.port && <Badge tone="blue"><Ship className="h-3 w-3" />{tx(c.port)}</Badge>}
              {c.featured && <Badge tone="gold"><Star className="h-3 w-3" />{t('ТОВАР НА ДЕНЯ · +{0} TC', DAILY_LOAD.coins)}</Badge>}
              {c.shared && <Badge tone="cyan"><Boxes className="h-3 w-3" />{t('ОБЩ ТОВАР НА КОМПАНИЯТА · +{0}%', Math.round(SHARED_LOAD.bonusShare * 100))}</Badge>}
              {c.favorite && <Star className="h-4 w-4 fill-gold-400 text-gold-400" aria-label={t('Любима линия')} />}
              {c.holiday === 'halloween' && <Badge tone="orange"><PumpkinIcon className="h-3.5 w-3.5" />{t('ХЕЛУИН · +{0}%', Math.round((HALLOWEEN.rewardMultiplier - 1) * 100))}</Badge>}
              {c.holiday === 'christmas' && <Badge tone="red"><ChristmasTreeIcon className="h-3.5 w-3.5" />{t('КОЛЕДА · +{0}%', Math.round((CHRISTMAS.rewardMultiplier - 1) * 100))}</Badge>}
              {c.holiday === 'easter' && <Badge tone="violet">{t('🥚 ВЕЛИКДЕН · +25%')}</Badge>}
              {c.holiday === 'marta' && <Badge tone="red">{t('🔴⚪ БАБА МАРТА · +{0}%', Math.round((MARTA.rewardMultiplier - 1) * 100))}</Badge>}
              {c.transEurope && <Badge tone="gold">{t('🌍 ТРАНСЕВРОПЕЙСКИ · двоен екипаж · +{0}%', Math.round((TRANS_EUROPE.multiplier - 1) * 100))}</Badge>}
              {c.temp && <Badge tone="blue">🌡️ {tx(c.temp)}</Badge>}
              {c.relayLeg && <Badge tone="cyan">{t('🏃 {0} · +{1} % ако и двамата сте навреме', relayLabel(c.relayLeg), Math.round(RELAY.bonusShare * 100))}</Badge>}
              {c.humanitarian && <Badge tone="red">{t('🆘 ХУМАНИТАРНА ПОМОЩ · +{0} TC навреме', RELIEF.coins)}</Badge>}
              {c.sealed && <Badge tone="violet">{t('📦 ЗАПЕЧАТАН · до +{0}% при отваряне', Math.round(SEALED.tiers.at(-1)!.bonus * 100))}</Badge>}
              {c.haggle && c.haggle !== 'open' && c.haggle.valid && <Badge tone="green">{t('🤝 ДОГОВОРЕНО +{0}%', c.haggle.percent)}</Badge>}
              {!!c.lez?.length && <Badge tone="green">{t('🌿 ЗОНА · {0}', c.lez.join(', '))}</Badge>}
              {c.specialization && <Badge tone="violet">{t('🎯 СПЕЦИАЛИЗАЦИЯ · +{0}%', Math.round(SPECIALIZATION.bonusShare * 100))}</Badge>}
              {!!c.traffic && <Badge tone="orange">{t('🚦 НАТОВАРЕНО · {0} камиона', c.traffic)}</Badge>}
              {c.holiday === 'harvest' && <Badge tone="orange">{t('🍇 ГРОЗДОБЕР · +{0}%', Math.round((HARVEST.rewardMultiplier - 1) * 100))}</Badge>}
              {c.holiday === 'sowing' && <Badge tone="green">{t('🌱 СЕИТБА · +{0}%', Math.round((SOWING.rewardMultiplier - 1) * 100))}</Badge>}
              {c.holiday === 'national' && <Badge tone="gold">{t('🎉 НАЦИОНАЛЕН ПРАЗНИК · +{0}%', Math.round((NATIONAL_DAY.rewardMultiplier - 1) * 100))}</Badge>}
              {!!c.oversizeCents && <Badge tone="orange">{t('⚠ ИЗВЪНГАБАРИТЕН · разрешително и придружител {0}', money(c.oversizeCents))}</Badge>}
              {c.roadWorks && <Badge tone="orange">🚧 {tx(c.roadWorks)}</Badge>}
              {!!c.urgentRaises && <Badge tone="red">{t('📈 +{0}% — никой не я е поел', c.urgentRaises * 10)}</Badge>}
              {c.toHome && <Badge tone="green"><House className="h-3 w-3" />{t('КЪМ БАЗАТА')}</Badge>}
              {c.project && <Badge tone="gold"><Hammer className="h-3 w-3" />{t('ФИРМЕН ПРОЕКТ')}</Badge>}
              {c.construction && <Badge tone="gold"><Hammer className="h-3 w-3" />{t('ЗА СТРОЕЖА НА КОМПАНИЯТА')}</Badge>}
              {c.lastLoad && <Badge tone="red"><Hammer className="h-3 w-3" />{t('ПОСЛЕДЕН ТОВАР · +{0}%', Math.round((PLOT.lastLoadFactor - 1) * 100))}</Badge>}
              {c.stops.length > 0 && <Badge tone="cyan"><Boxes className="h-3 w-3" />{t('СБОРЕН · {0} {1} · +{2}%', c.stops.length, c.stops.length === 1 ? t('СПИРКА') : t('СПИРКИ'), Math.round(MULTISTOP.stopBonusShare * c.stops.length * 100))}</Badge>}
              {c.hiredBy && <span className="max-w-full truncate" title={t('Възложена от {0} до {1}', c.hiredBy.company, c.hiredBy.until)}><Badge tone="violet"><BadgeCheck className="h-3 w-3" />{t('ВЪЗЛОЖЕНА · {0}% за {1}', Math.round(c.hiredBy.share * 100), c.hiredBy.company)}</Badge></span>}
              {c.convoy && <Badge tone="violet"><Truck className="h-3 w-3" />{t('КОНВОЙ С {0} · +{1}%', c.convoy, Math.round(CONVOY_RULES.bonusShare * 100))}</Badge>}
              {c.holiday === 'winter' && <Badge tone="cyan"><Snowflake className="h-3 w-3" />{t('ЗИМЕН ТОВАР · +{0}%', Math.round((WINTER.rewardMultiplier - 1) * 100))}</Badge>}
              {c.weather && <Badge tone={c.weather.condition === 'snow' ? 'blue' : 'red'}><Snowflake className="h-3 w-3" />{tx(c.weather.label)} ({tx(c.weather.country)})</Badge>}
              {c.minReputation > 0 && <Badge tone="gold"><Star className="h-3 w-3" />{t('ПРЕМИУМ · репутация {0}', c.minReputation)}</Badge>}
              {c.alreadyTaken && <Badge tone="green">{t('Вече я поехте')}</Badge>}
              {c.reservedByMe && <Badge tone="gold">{t('Запазена за теб до {0}', c.reservedUntil)}</Badge>}
              {c.reservedByOther && <Badge tone="neutral">{t('Запазена до {0}', c.reservedUntil)}</Badge>}
              {c.opensAt && <Badge tone="violet">{t('VIP · за всички от {0}', c.opensAt)}</Badge>}
              {c.local && <Badge tone="gold"><MapPinned className="h-3 w-3" />{c.options.some((o) => !o.error && o.emptyKm === 0) ? t('За камиона ти тук') : t('Във вашия град')}</Badge>}
            </Bonuses>
          </div>
          {reason && <div className="mt-1 flex items-start gap-1.5 text-xs text-amber-sig"><AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />{t('Не можеш да я вземеш: {0}', reason)}</div>}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm">
            <span className="font-medium">{tx(c.origin.name)}</span>
            <span className="text-[11px] text-mist-400">{tx(c.origin.country)}</span>
            {c.stops.map((st) => (
              <span key={st.name} className="contents">
                <ArrowRight className="h-3.5 w-3.5 text-mist-400" />
                <span className="text-cyan-glow" title={t('Разтоварване на {0} т · срок {1}', dec(st.tons), duration(st.windowMinutes))}>{tx(st.name)}</span>
                <span className="text-[11px] text-mist-400">{tx(st.country)}</span>
              </span>
            ))}
            <ArrowRight className="h-3.5 w-3.5 text-mist-400" />
            <span className="font-medium">{tx(c.destination.name)}</span>
            <span className="text-[11px] text-mist-400">{tx(c.destination.country)}</span>
          </div>
        </div>
        <div className="hidden text-xs text-mist-400 sm:block">
          <div className="flex items-center gap-1.5"><Route className="h-3.5 w-3.5" /><span className="num">{km(c.distanceKm)}</span>{c.provider === 'approximate' && <Badge tone="orange">{t('приблизително')}</Badge>}</div>
          <div className="mt-1 flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />{t('срок {0}', duration(c.windowMinutes))}{c.expiresInMin < 120 && <span className="text-amber-sig">{t('· изтича скоро')}</span>}</div>
        </div>
        <div className="text-right">
          <div className="num font-display text-lg font-bold text-profit">{money(c.rewardCents)}</div>
          <div className="num text-[11px] text-mist-400">{t('{0} лв./км', dec(c.rewardCents / 100 / c.distanceKm))}</div>
        </div>
      </button>

      {open && (
        <div className="border-t border-asphalt-700 bg-asphalt-850/60 p-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-4">
            <div><dt className="label">{t('Възложител')}</dt><dd className="mt-1">{tx(c.shipper)}</dd></div>
            <div><dt className="label">{t('Маршрут')}</dt><dd className="mt-1">{c.countries.join(' → ')} · {c.borders ? t('{0} граница', c.borders) : t('без граница')}{c.hasToll ? t(' · тол') : ''}</dd></div>
            <div><dt className="label">{t('Срок за доставка')}</dt><dd className="mt-1">{t('{0} от приемането', duration(c.windowMinutes))}</dd></div>
            <div><dt className="label">{t('Изтича от борсата')}</dt><dd className="mt-1">{dateTime(c.expiresAt)}</dd></div>
          </dl>
          {c.stops.length > 0 && (
            <div className="mt-3 rounded-xl border border-cyan-glow/30 bg-cyan-glow/5 p-3 text-sm">
              <div className="font-semibold text-cyan-glow">{t('Сборен товар — разтоварване по пътя')}</div>
              <ol className="mt-1.5 space-y-1 text-mist-300">
                {c.stops.map((st, i) => <li key={st.name}>{t('{0}. {1} ({2}) — {3} т, до {4} от приемането', i + 1, st.name, st.country, dec(st.tons), duration(st.windowMinutes))}</li>)}
                <li>{t('{0}. {1} ({2}) — останалото, до {3}', c.stops.length + 1, c.destination.name, c.destination.country, duration(c.windowMinutes))}</li>
              </ol>
              <p className="mt-1.5 text-xs text-mist-400">{t('Всяка спирка има свой срок. Закъснялата спирка струва {0}% от своя дял в заплащането.', Math.round(MULTISTOP.latePenaltyShare * 100))}</p>
            </div>
          )}
          <div className="mt-3">
            <button type="button" className="inline-flex items-center gap-1.5 text-sm text-mist-300 hover:text-gold-400" onClick={toggleFavorite} disabled={favBusy}>
              <Star className={`h-4 w-4 ${c.favorite ? 'fill-gold-400 text-gold-400' : ''}`} />
              {c.favorite ? t('Любима линия {0} → {1} (премахни)', c.origin.name, c.destination.name) : t('Направи {0} → {1} любима линия — първа в списъка и известие за нови поръчки', c.origin.name, c.destination.name)}
            </button>
          </div>

          {c.hiredBy && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-prestige/40 bg-prestige/10 px-3 py-2 text-sm">
              <span>{t('„{0}“ ти възлага този курс. Караш със свой камион и плащаш {1}% от наградата ({2}) на компанията при доставката.', c.hiredBy.company, Math.round(c.hiredBy.share * 100), money(Math.round(c.rewardCents * c.hiredBy.share)))}</span>
              <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => void api('/api/game/action', { type: 'declineJob', offerId: c.hiredBy!.offerId }).then(() => router.refresh(), (e: Error) => setError(e.message))}>{t('Откажи')}</button>
            </div>
          )}
          {canAssign && !c.urgent && !c.tender && !c.reservedByOther && !c.hiredBy && (
            <div className="mt-3">
              <button type="button" className="inline-flex items-center gap-1.5 text-sm text-mist-300 hover:text-prestige" onClick={() => setHiring(true)}><BadgeCheck className="h-4 w-4" />{t('Възложи на свободен шофьор срещу комисиона за касата')}</button>
            </div>
          )}
          {hiring && <HireDialog contract={{ id: c.id, goods: c.goods, rewardCents: c.rewardCents, origin: c.origin.name, destination: c.destination.name }} onClose={() => setHiring(false)} />}
          {c.featured && (
            <p className="mt-3 rounded-lg border border-gold-400/40 bg-gold-400/10 px-3 py-2 text-sm text-mist-200">
              {t('Товарът на деня: по-добро заплащане и +{0} ТрансКоин при доставка навреме. Взима се само цял — от първия, който го поеме.', DAILY_LOAD.coins)}
            </p>
          )}
          {c.shared && (
            <p className="mt-3 rounded-lg border border-cyan-glow/40 bg-cyan-glow/5 px-3 py-2 text-sm text-mist-200">
              {t('Общ товар на компанията: вземете го на части с камионите си. Ако всички части стигнат навреме, всеки получава +{0}% от своята част и значка „Отборен товар“.', Math.round(SHARED_LOAD.bonusShare * 100))}
            </p>
          )}
          {c.canShare && <ShareButton contractId={c.id} tons={c.tons} />}
          {c.urgent && (
            <p className="mt-3 rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-mist-200">
              {t('Спешна поръчка: камионът стига до {0} за 1 минута, където и да е, а курсът върви ×{1} по-бързо. Може да я поеме всеки играч със свободен камион (по веднъж), докато не изтече от борсата.', c.origin.name, dec(c.speedFactor))}
            </p>
          )}
          {c.alreadyTaken ? (
            <p className="mt-4 text-sm text-profit">{t('Вече сте поели тази спешна поръчка — следете я в „Автопарк“.')}</p>
          ) : c.opensAt ? (
            <p className="mt-4 text-sm text-prestige">{t('VIP играчите поемат спешните доставки 5 минути по-рано. За всички се отваря в {0}.', c.opensAt)}</p>
          ) : c.reservedByOther ? (
            <p className="mt-4 text-sm text-mist-300">{t('Друг играч е запазил тази поръчка до {0}. След това отново е свободна.', c.reservedUntil)}</p>
          ) : c.locked ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-prestige"><Lock className="h-4 w-4" />{t('Достигнете ниво {0}, за да поемате такива товари.', c.minLevel)}</p>
          ) : c.reputationLocked ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-gold-400"><Star className="h-4 w-4" />{t('Премиум поръчка — плаща повече, но е само за превозвачи с репутация {0}+. Репутацията расте с всяка доставка навреме.', c.minReputation)}</p>
          ) : c.missingLicences.length ? (
            <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-amber-sig">
              <BadgeCheck className="h-4 w-4" />{t('Нужен е лиценз: {0}.', c.missingLicences.join(', '))}
              <Link href="/game/licences" className="text-cyan-glow hover:underline">{t('Към лицензите →')}</Link>
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {c.sealed && (
                <p className="rounded-xl border border-prestige/40 bg-prestige/10 p-3 text-sm">
                  {t('📦 Клиентът не казва какво има вътре. Наградата е поне {0}; при пристигане навреме пратката може да се окаже ценна (+{1}%) или изключителна (+{2}%). Само игрови пари.', money(c.rewardCents), Math.round(SEALED.tiers[1].bonus * 100), Math.round(SEALED.tiers[2].bonus * 100))}
                </p>
              )}
              {c.haggle && <HaggleBox contractId={c.id} rewardCents={c.rewardCents} haggle={c.haggle} />}
              <div className="rounded-xl border border-asphalt-600 bg-asphalt-800/60 p-3 text-sm">
                <div className="label">{t('Какво е нужно за тази поръчка')}</div>
                <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                  <li><span className="text-mist-400"><Term id="body">{t('Надстройка')}</Term>: </span><span className="font-semibold">{c.needs.bodies.join(t(' или '))}</span></li>
                  <li><span className="text-mist-400">{t('Товар:')}{' '}</span><span className="num font-semibold">{t('{0} т', dec(c.tons))}</span>{canSplitHint ? <span className="text-mist-400">{' '}{t('(може и на части)')}</span> : null}</li>
                  {c.needs.level > 1 && <li><span className="text-mist-400">{t('Ниво:')}{' '}</span><span className="font-semibold">{tx(c.needs.level)}+</span></li>}
                </ul>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <select className="input min-w-0 flex-1" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} aria-label={t('Превозно средство')}>
                  <option value="">{t('— изберете превозно средство —')}</option>
                  {usable.length > 0 && (
                    <optgroup label={t('Могат да поемат')}>
                      {usable.map((o) => <option key={o.vehicleId} value={o.vehicleId}>{tx(o.label)}{o.part && !o.overloadPercent ? t(' — част: {0} т', dec(o.part.tons)) : ''}</option>)}
                    </optgroup>
                  )}
                  {blocked.length > 0 && (
                    <optgroup label={t('Не могат (причините са под списъка)')}>
                      {blocked.map((o) => <option key={o.vehicleId} value={o.vehicleId} disabled>{tx(o.label)}</option>)}
                    </optgroup>
                  )}
                </select>
                <button className="btn-primary" disabled={!vehicleId || !!option?.error || busy || (needsOverload && !overload && !part)} onClick={accept}>
                  <ShieldCheck className="h-4 w-4" />{busy ? t('Изпращане…') : part ? t('Вземи {0} т и изпрати', dec(part.tons)) : t('Приеми и изпрати')}
                </button>
                <Link href={`/game/map?contract=${c.id}`} className="btn-ghost"><MapPinned className="h-4 w-4" />{t('На картата')}</Link>
                {vip && !c.urgent && !c.reservedByMe && <ReserveButton contractId={c.id} />}
              </div>
              {option && !option.error && (option.rushMinutes != null || needsOverload || insuranceLive || parkingLive || refuelLive || (routeChoice && !c.urgent && !c.stops.length && !c.ferry)) && (
                <div className="space-y-1.5 rounded-xl border border-amber-sig/30 bg-amber-sig/5 p-3 text-sm">
                  {routeChoice && !c.urgent && !c.stops.length && !c.ferry && !rail && (
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-0.5" checked={cheap} onChange={(e) => setCheap(e.target.checked)} />
                      <span>{t('Евтин маршрут — без магистрали и пътни такси, по истински по-бавни пътища. Пристига по-късно; срокът остава същият.')}</span>
                    </label>
                  )}
                  {refuelLive && (
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-0.5" checked={refuel} onChange={(e) => setRefuel(e.target.checked)} />
                      <span>{t('Зареди в най-евтината държава по пътя — докъдето стига резервоарът (цените на горивото са игрови данни).')}</span>
                    </label>
                  )}
                  {parkingLive && (
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-0.5" checked={secure} onChange={(e) => setSecure(e.target.checked)} />
                      <span>{t('Охраняем паркинг, ако шофьорът нощува по пътя — {0} на нощувка. Без него има малък риск да откраднат гориво.', money(SECURE_PARKING.feeCents))}</span>
                    </label>
                  )}
                  {insuranceLive && (
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-0.5" checked={insure} onChange={(e) => setInsure(e.target.checked)} />
                      <span>{t('Застраховай товара — {0}. При закъснение връща {1} % от неустойката.', money(Math.round((part ? part.rewardCents : c.rewardCents) * CARGO_INSURANCE.premiumShare)), Math.round(CARGO_INSURANCE.covers * 100))}</span>
                    </label>
                  )}
                  {option.rushMinutes != null && (
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-0.5" checked={rush} onChange={(e) => setRush(e.target.checked)} />
                      <span>{t('Без задължителната почивка — пристига след ≈ {0} вместо ≈ {1}.', duration(option.rushMinutes), duration(option.minutes))}{' '}<span className="text-amber-sig">{t('Риск от глоба при проверка на тахографа.')}</span></span>
                    </label>
                  )}
                  {needsOverload && (
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-0.5" checked={overload} onChange={(e) => setOverload(e.target.checked)} />
                      <span>{t('{0} с претоварване (+{1}% над капацитета).', option.part ? t('Вместо част — натовари всичко') : t('Натовари'), option.overloadPercent)}{' '}<span className="text-amber-sig">{t('Риск от глоба на кантар и по-бързо износване.')}</span></span>
                    </label>
                  )}
                </div>
              )}
              {c.ferry && (
                <p className="rounded-xl border border-cyan-glow/30 bg-cyan-glow/5 p-3 text-sm">
                  <span className="font-semibold text-cyan-glow">{tx(c.ferry.note)}: </span>
                  {t('камионът чака на пристанището следващия ферибот (тръгват на всеки час), шофьорът почива на борда. Билет {0}; за морето няма гориво и такси. Разписанието и цените са игрови данни.', money(c.ferry.ticketCents))}
                </p>
              )}
              {!!c.rail?.length && (
                <div className="space-y-1.5 rounded-xl border border-volt-500/30 bg-volt-500/5 p-3 text-sm">
                  <label className="flex items-start gap-2">
                    <input type="radio" name={`rail-${c.id}`} className="mt-0.5" checked={!rail} onChange={() => setRail('')} />
                    <span>{t('По пътя')}</span>
                  </label>
                  {c.rail.map((r) => (
                    <label key={r.id} className="flex items-start gap-2">
                      <input type="radio" name={`rail-${c.id}`} className="mt-0.5" checked={rail === r.id} onChange={() => setRail(r.id)} />
                      {r.kind === 'ferry' ? (
                        <span><Ship className="mr-1 inline h-3.5 w-3.5 text-cyan-glow" /><b>{tx(r.note)}</b>{' '}{t('({0} км по море, ~{1} ч) — камионът се качва на ферибота, шофьорът почива, а пътят до пристанищата е по-кратък от целия път по суша. Билет {2}; фериботите тръгват на всеки час (игрово разписание).', int(r.km), r.hours, money(r.ticketCents))}</span>
                      ) : (
                        <span><TrainFront className="mr-1 inline h-3.5 w-3.5 text-volt-400" /><b>{tx(r.note)}</b>{' '}{t('({0} км с влак) — камионът се качва на влака, шофьорът почива, а за тези километри няма гориво, такси и износване. Билет {1}; влаковете тръгват на всеки 30 мин (игрово разписание).', int(r.km), money(r.ticketCents))}</span>
                      )}
                    </label>
                  ))}
                </div>
              )}
              {part && (
                <p className="rounded-xl border border-cyan-glow/30 bg-cyan-glow/5 p-3 text-sm">
                  <span className="font-semibold text-cyan-glow">{t('Част от товара:')}{' '}</span>
                  {t('камионът побира {0} т от {1} т — заплащане', dec(part.tons), dec(c.tons))}{' '}<span className="num font-semibold text-profit">{money(part.rewardCents)}</span>{' '}{t('(делът от тоновете). Останалите {0} т остават на борсата за други камиони.', dec(Math.round((c.tons - part.tons) * 10) / 10))}
                </p>
              )}
              {option && !option.error && (
                <div className="grid gap-2 text-sm sm:grid-cols-4">
                  <div className="rounded-lg bg-asphalt-800 px-3 py-2"><span className="text-mist-400">{t('Празен курс')}{' '}</span><span className="num">{t('≈ {0} км{1}', int(option.emptyKm), c.urgent && option.emptyKm > 0 ? t(' · 1 мин') : '')}</span></div>
                  <div className="rounded-lg bg-asphalt-800 px-3 py-2"><span className="text-mist-400">{option.rented ? t('Наем ') : t('Разходи (оценка) ')}</span><span className="num text-loss">{money(option.costCents)}</span></div>
                  <div className="rounded-lg bg-asphalt-800 px-3 py-2"><span className="text-mist-400">{t('Печалба (оценка)')}{' '}</span><span className={`num ${shownProfit >= 0 ? 'text-profit' : 'text-loss'}`}>{money(shownProfit)}</span></div>
                  <div className={`rounded-lg px-3 py-2 ${shownMinutes > c.windowMinutes ? 'bg-loss/10 text-loss' : 'bg-asphalt-800'}`}>
                    <span className="text-mist-400">{t('Пристигане след')}{' '}</span><span className="num">≈ {duration(shownMinutes)}</span>
                    {shownMinutes > c.windowMinutes && <span className="ml-1 inline-flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />{t('риск от закъснение')}</span>}
                  </div>
                </div>
              )}
              <WhyNot blocked={blocked.map((o) => ({ label: o.label, error: o.error! }))} anyUsable={usable.length > 0} />
              {error && <p role="alert" className="text-sm text-loss">{error}</p>}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** Share a big load with the company: from then on only the members see it and take parts of it. */
function ShareButton({ contractId, tons }: { contractId: string; tons: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const share = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/game/action', { type: 'shareLoad', contractId });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      <button type="button" className="inline-flex items-center gap-1.5 text-mist-300 hover:text-cyan-glow" onClick={share} disabled={busy}>
        <Boxes className="h-4 w-4" />{t('Сподели {0} т с компанията — членовете го карат на части и всеки получава +{1}%, ако всичко стигне навреме', dec(tons), Math.round(SHARED_LOAD.bonusShare * 100))}
      </button>
      {error && <span role="alert" className="text-loss">{error}</span>}
    </div>
  );
}

/** VIP: hold the contract for ten minutes while deciding. */
function ReserveButton({ contractId }: { contractId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reserve = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/game/action', { type: 'reserveContract', contractId });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex flex-col">
      <button className="btn-ghost border-gold-400/40 text-gold-400" onClick={reserve} disabled={busy} title={t('VIP: само ти можеш да я поемеш следващите 10 минути')}>
        {busy ? '…' : t('Запази за 10 мин')}
      </button>
      {error && <span role="alert" className="text-xs text-loss">{error}</span>}
    </span>
  );
}
