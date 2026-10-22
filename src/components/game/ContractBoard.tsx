'use client';

import { AlertTriangle, ArrowRight, BadgeCheck, Boxes, Clock, Lock, MapPinned, Route, Search, Ship, ShieldCheck, Hammer, House, Siren, Snowflake, Star, TrainFront, Truck } from 'lucide-react';
import { ChristmasTreeIcon, PumpkinIcon } from '@/components/seasonal/icons';
import { HALLOWEEN } from '@/lib/game/halloween';
import { CHRISTMAS } from '@/lib/game/christmas';
import { WINTER } from '@/lib/game/winter';
import { CONVOY_RULES } from '@/lib/game/convoy';
import { PLOT } from '@/lib/game/plot';
import { MULTISTOP } from '@/lib/game/multistop';
import { DAILY_LOAD, SHARED_LOAD } from '@/lib/game/together';
import { HireDialog } from './HireDialog';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Empty, type BadgeTone } from '@/components/ui';
import { api } from '@/lib/client/api';
import { dateTime, dec, duration, int, km, money } from '@/lib/format';
import type { CargoType } from '@/lib/game/cargo';
import { MARTA } from '@/lib/game/marta';
import { CARGO_INSURANCE } from '@/lib/game/roads';
import { useFeature } from './Features';

export interface BoardContract {
  id: string;
  shipper: string;
  goods: string;
  cargoType: CargoType;
  cargoLabel: string;
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
  rail?: { id: string; note: string; ticketCents: number; km: number }[];
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
type Chip = 'fav' | 'home' | 'hired' | 'stops' | 'halloween' | 'christmas' | 'marta' | 'oversize' | 'winter' | 'clear' | 'licence' | 'fast' | 'perKm';

const CHIPS: { id: Chip; label: string; test: (c: BoardContract) => boolean }[] = [
  { id: 'fav', label: '★ Любими линии', test: (c) => c.favorite },
  { id: 'home', label: 'Към базата', test: (c) => c.toHome },
  { id: 'hired', label: 'Възложени на мен', test: (c) => !!c.hiredBy },
  { id: 'stops', label: 'Сборни товари', test: (c) => c.stops.length > 0 },
  { id: 'halloween', label: 'Хелуин', test: (c) => c.holiday === 'halloween' },
  { id: 'christmas', label: 'Коледа', test: (c) => c.holiday === 'christmas' },
  { id: 'marta', label: 'Баба Марта', test: (c) => c.holiday === 'marta' },
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
  ['oversize', (c) => !!c.oversizeCents],
  ['winter', (c) => c.holiday === 'winter'],
  ['clear', (c) => !!c.weather],
]);

export function ContractBoard({ contracts, cargoTypes, localCityNames, vip = false, initialChips = [], canAssign = false, focus }: { contracts: BoardContract[]; cargoTypes: { id: string; label: string }[]; localCityNames: string[]; vip?: boolean; initialChips?: Chip[]; canAssign?: boolean; focus?: string }) {
  const [chips, setChips] = useState<Set<Chip>>(() => new Set(initialChips));
  const toggleChip = (id: Chip) => setChips((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const [cargo, setCargo] = useState<string>('');
  const [query, setQuery] = useState('');
  const [doable, setDoable] = useState(false);
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
      setSavedNote('Филтърът е запазен.');
    } catch {
      setSavedNote('Браузърът не позволява запазване.');
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
    // Own city first — jobs the player can take right now before the rest.
    // Urgent shipments first, then the player's own city.
    const takeable = (c: BoardContract) => !c.locked && !c.reputationLocked && !c.alreadyTaken && !c.reservedByOther && !c.opensAt && !c.missingLicences.length && c.options.some((o) => !o.error);
    // Favourite lanes the player can take come right after urgent shipments.
    const rank = (c: BoardContract) => (c.id === focus ? -2 : c.featured ? -1 : c.urgent ? 0 : c.shared && takeable(c) ? 1 : c.favorite && takeable(c) ? 1 : c.tender && takeable(c) ? 2 : c.local ? (takeable(c) ? 2 : 3) : 4);
    return filtered.sort((a, b) => rank(a) - rank(b) || key[sort](a) - key[sort](b));
  }, [contracts, cargo, query, doable, sort, chips, focus]);

  return (
    <div className="space-y-4">
      {sent && (
        <div role="status" className="sticky top-16 z-20 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-profit/40 bg-asphalt-900/95 px-4 py-3 text-sm shadow-lg backdrop-blur lg:top-20">
          <Truck className="h-4 w-4 shrink-0 text-profit" />
          <span className="min-w-0 flex-1 basis-[calc(100%-2rem)] sm:basis-auto">{sent}</span>
          <Link href="/game/fleet" className="text-cyan-glow hover:underline">Автопарк</Link>
          <Link href="/game/map" className="text-cyan-glow hover:underline">Карта</Link>
          <button type="button" className="text-mist-400 hover:text-white" onClick={() => setSent(null)} aria-label="Скрий">✕</button>
        </div>
      )}
      <div className="panel flex flex-wrap items-center gap-3 p-3">
        <label className="relative w-full min-w-[200px] flex-1 sm:w-auto">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mist-400" />
          <input className="input pl-9" placeholder="Град или стока…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Търсене" />
        </label>
        <select className="input w-[calc(50%-0.375rem)] text-sm sm:w-auto" value={cargo} onChange={(e) => setCargo(e.target.value)} aria-label="Вид товар">
          <option value="">Всички товари</option>
          {cargoTypes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <select className="input w-[calc(50%-0.375rem)] text-sm sm:w-auto" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Подреждане">
          <option value="reward">Най-доходни</option>
          <option value="perKm">Най-добре на км</option>
          <option value="distance">Най-къси</option>
          <option value="expires">Изтичат скоро</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-mist-300">
          <input type="checkbox" checked={doable} onChange={(e) => setDoable(e.target.checked)} className="h-4 w-4 accent-cyan-500" />
          Само изпълними с моя автопарк
        </label>
        {vip && (
          <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={saveFilter} title="VIP: запомни тези филтри">
            Запази филтъра{savedNote ? ' ✓' : ''}
          </button>
        )}
        <span className="num ml-auto text-xs text-mist-400">{list.length} от {contracts.length}</span>
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Бързи филтри">
        {CHIPS.filter((chip) => !SEASONAL_CHIPS.has(chip.id) || contracts.some(SEASONAL_CHIPS.get(chip.id)!)).map((chip) => (
          <button key={chip.id} type="button" aria-pressed={chips.has(chip.id)} onClick={() => toggleChip(chip.id)} className={`shrink-0 rounded-full border px-3 py-1.5 text-sm transition ${chips.has(chip.id) ? 'border-volt-500 bg-volt-500/20 text-white' : 'border-asphalt-700 text-mist-300 hover:text-white'}`}>
            {chip.label}
          </button>
        ))}
      </div>
      {localCityNames.length > 0 && (
        <p className="flex items-center gap-2 text-sm text-mist-300">
          <MapPinned className="h-4 w-4 text-gold-400" />
          Първо са поръчките от {localCityNames.join(', ')} — там те чака свободен камион.
        </p>
      )}
      {list.length === 0 ? (
        <Empty icon={Truck} title="Няма поръчки по тези критерии">Пазарът се обновява на всеки няколко минути.</Empty>
      ) : (
        <ul className="space-y-2">
          {list.map((c) => (
            <ContractRow key={c.id} contract={c} vip={vip} canAssign={canAssign} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} onAccepted={(text) => { setSent(text); setOpen(null); }} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ContractRow({ contract: c, vip, canAssign, open, onToggle, onAccepted }: { contract: BoardContract; vip: boolean; canAssign: boolean; open: boolean; onToggle: () => void; onAccepted: (text: string) => void }) {
  const [hiring, setHiring] = useState(false);
  const router = useRouter();
  const usable = c.options.filter((o) => !o.error);
  const [vehicleId, setVehicleId] = useState(usable[0]?.vehicleId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const option = c.options.find((o) => o.vehicleId === vehicleId);
  const [rush, setRush] = useState(false);
  const [overload, setOverload] = useState(false);
  const [insure, setInsure] = useState(false);
  const insuranceLive = useFeature('cargo_insurance');
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
      await api('/api/game/action', { type: 'acceptContract', contractId: c.id, vehicleId, rush: rush && option?.rushMinutes != null, overload: needsOverload && overload, ...(part ? { tons: part.tons } : {}), ...(rail ? { rail } : {}), insure: insuranceLive && insure });
      onAccepted(`Камионът тръгна: ${part ? `${dec(part.tons)} т ` : ''}${c.goods}, ${c.origin.name} → ${c.destination.name}. Можеш да поемеш следващата поръчка.`);
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
            <Badge tone={CARGO_TONE[c.cargoType]}>{c.cargoLabel}</Badge>
            <span className="truncate font-semibold">{c.goods}</span>
            <span className="num text-sm text-mist-400">{dec(c.tons)} т</span>
            {c.urgent && <Badge tone="red"><Siren className="h-3 w-3" />СПЕШНО · ×{dec(c.speedFactor)} по-бързо · до товара за 1 мин</Badge>}
            {c.tender && <Badge tone="violet">ТЪРГ НА КОМПАНИЯТА</Badge>}
            {c.exchange && <Badge tone="violet">БОРСА МЕЖДУ ИГРАЧИ</Badge>}
            {c.rally && <Badge tone="orange">🏁 РАЛИ — мери се времето и горивото</Badge>}
            {c.ferry && <Badge tone="cyan"><Ship className="h-3 w-3" />{c.ferry.note.toUpperCase()}</Badge>}
            {c.port && <Badge tone="blue"><Ship className="h-3 w-3" />{c.port}</Badge>}
            {c.featured && <Badge tone="gold"><Star className="h-3 w-3" />ТОВАР НА ДЕНЯ · +{DAILY_LOAD.coins} TC</Badge>}
            {c.shared && <Badge tone="cyan"><Boxes className="h-3 w-3" />ОБЩ ТОВАР НА КОМПАНИЯТА · +{Math.round(SHARED_LOAD.bonusShare * 100)}%</Badge>}
            {c.favorite && <Star className="h-4 w-4 fill-gold-400 text-gold-400" aria-label="Любима линия" />}
            {c.holiday === 'halloween' && <Badge tone="orange"><PumpkinIcon className="h-3.5 w-3.5" />ХЕЛУИН · +{Math.round((HALLOWEEN.rewardMultiplier - 1) * 100)}%</Badge>}
            {c.holiday === 'christmas' && <Badge tone="red"><ChristmasTreeIcon className="h-3.5 w-3.5" />КОЛЕДА · +{Math.round((CHRISTMAS.rewardMultiplier - 1) * 100)}%</Badge>}
            {c.holiday === 'marta' && <Badge tone="red">🔴⚪ БАБА МАРТА · +{Math.round((MARTA.rewardMultiplier - 1) * 100)}%</Badge>}
            {!!c.oversizeCents && <Badge tone="orange">⚠ ИЗВЪНГАБАРИТЕН · разрешително и придружител {money(c.oversizeCents)}</Badge>}
            {c.roadWorks && <Badge tone="orange">🚧 {c.roadWorks}</Badge>}
            {!!c.urgentRaises && <Badge tone="red">📈 +{c.urgentRaises * 10}% — никой не я е поел</Badge>}
            {c.toHome && <Badge tone="green"><House className="h-3 w-3" />КЪМ БАЗАТА</Badge>}
            {c.project && <Badge tone="gold"><Hammer className="h-3 w-3" />ФИРМЕН ПРОЕКТ</Badge>}
            {c.construction && <Badge tone="gold"><Hammer className="h-3 w-3" />ЗА СТРОЕЖА НА КОМПАНИЯТА</Badge>}
            {c.lastLoad && <Badge tone="red"><Hammer className="h-3 w-3" />ПОСЛЕДЕН ТОВАР · +{Math.round((PLOT.lastLoadFactor - 1) * 100)}%</Badge>}
            {c.stops.length > 0 && <Badge tone="cyan"><Boxes className="h-3 w-3" />СБОРЕН · {c.stops.length} {c.stops.length === 1 ? 'СПИРКА' : 'СПИРКИ'} · +{Math.round(MULTISTOP.stopBonusShare * c.stops.length * 100)}%</Badge>}
            {c.hiredBy && <span className="max-w-full truncate" title={`Възложена от ${c.hiredBy.company} до ${c.hiredBy.until}`}><Badge tone="violet"><BadgeCheck className="h-3 w-3" />ВЪЗЛОЖЕНА · {Math.round(c.hiredBy.share * 100)}% за {c.hiredBy.company}</Badge></span>}
            {c.convoy && <Badge tone="violet"><Truck className="h-3 w-3" />КОНВОЙ С {c.convoy} · +{Math.round(CONVOY_RULES.bonusShare * 100)}%</Badge>}
            {c.holiday === 'winter' && <Badge tone="cyan"><Snowflake className="h-3 w-3" />ЗИМЕН ТОВАР · +{Math.round((WINTER.rewardMultiplier - 1) * 100)}%</Badge>}
            {c.weather && <Badge tone={c.weather.condition === 'snow' ? 'blue' : 'red'}><Snowflake className="h-3 w-3" />{c.weather.label} ({c.weather.country})</Badge>}
            {c.minReputation > 0 && <Badge tone="gold"><Star className="h-3 w-3" />ПРЕМИУМ · репутация {c.minReputation}</Badge>}
            {c.alreadyTaken && <Badge tone="green">Вече я поехте</Badge>}
            {c.reservedByMe && <Badge tone="gold">Запазена за теб до {c.reservedUntil}</Badge>}
            {c.reservedByOther && <Badge tone="neutral">Запазена до {c.reservedUntil}</Badge>}
            {c.opensAt && <Badge tone="violet">VIP · за всички от {c.opensAt}</Badge>}
            {c.local && <Badge tone="gold"><MapPinned className="h-3 w-3" />Във вашия град</Badge>}
            {c.missingLicences.length > 0 && <Badge tone="orange"><BadgeCheck className="h-3 w-3" />Лиценз: {c.missingLicences.join(', ')}</Badge>}
            {c.locked && <Badge tone="violet"><Lock className="h-3 w-3" />ниво {c.minLevel}</Badge>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm">
            <span className="font-medium">{c.origin.name}</span>
            <span className="text-[11px] text-mist-400">{c.origin.country}</span>
            {c.stops.map((st) => (
              <span key={st.name} className="contents">
                <ArrowRight className="h-3.5 w-3.5 text-mist-400" />
                <span className="text-cyan-glow" title={`Разтоварване на ${dec(st.tons)} т · срок ${duration(st.windowMinutes)}`}>{st.name}</span>
                <span className="text-[11px] text-mist-400">{st.country}</span>
              </span>
            ))}
            <ArrowRight className="h-3.5 w-3.5 text-mist-400" />
            <span className="font-medium">{c.destination.name}</span>
            <span className="text-[11px] text-mist-400">{c.destination.country}</span>
          </div>
        </div>
        <div className="hidden text-xs text-mist-400 sm:block">
          <div className="flex items-center gap-1.5"><Route className="h-3.5 w-3.5" /><span className="num">{km(c.distanceKm)}</span>{c.provider === 'approximate' && <Badge tone="orange">приблизително</Badge>}</div>
          <div className="mt-1 flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />срок {duration(c.windowMinutes)}{c.expiresInMin < 120 && <span className="text-amber-sig">· изтича скоро</span>}</div>
        </div>
        <div className="text-right">
          <div className="num font-display text-lg font-bold text-profit">{money(c.rewardCents)}</div>
          <div className="num text-[11px] text-mist-400">{dec(c.rewardCents / 100 / c.distanceKm)} лв./км</div>
        </div>
      </button>

      {open && (
        <div className="border-t border-asphalt-700 bg-asphalt-850/60 p-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-4">
            <div><dt className="label">Възложител</dt><dd className="mt-1">{c.shipper}</dd></div>
            <div><dt className="label">Маршрут</dt><dd className="mt-1">{c.countries.join(' → ')} · {c.borders ? `${c.borders} граница` : 'без граница'}{c.hasToll ? ' · тол' : ''}</dd></div>
            <div><dt className="label">Срок за доставка</dt><dd className="mt-1">{duration(c.windowMinutes)} от приемането</dd></div>
            <div><dt className="label">Изтича от борсата</dt><dd className="mt-1">{dateTime(c.expiresAt)}</dd></div>
          </dl>
          {c.stops.length > 0 && (
            <div className="mt-3 rounded-xl border border-cyan-glow/30 bg-cyan-glow/5 p-3 text-sm">
              <div className="font-semibold text-cyan-glow">Сборен товар — разтоварване по пътя</div>
              <ol className="mt-1.5 space-y-1 text-mist-300">
                {c.stops.map((st, i) => <li key={st.name}>{i + 1}. {st.name} ({st.country}) — {dec(st.tons)} т, до {duration(st.windowMinutes)} от приемането</li>)}
                <li>{c.stops.length + 1}. {c.destination.name} ({c.destination.country}) — останалото, до {duration(c.windowMinutes)}</li>
              </ol>
              <p className="mt-1.5 text-xs text-mist-400">Всяка спирка има свой срок. Закъснялата спирка струва {Math.round(MULTISTOP.latePenaltyShare * 100)}% от своя дял в заплащането.</p>
            </div>
          )}
          <div className="mt-3">
            <button type="button" className="inline-flex items-center gap-1.5 text-sm text-mist-300 hover:text-gold-400" onClick={toggleFavorite} disabled={favBusy}>
              <Star className={`h-4 w-4 ${c.favorite ? 'fill-gold-400 text-gold-400' : ''}`} />
              {c.favorite ? `Любима линия ${c.origin.name} → ${c.destination.name} (премахни)` : `Направи ${c.origin.name} → ${c.destination.name} любима линия — първа в списъка и известие за нови поръчки`}
            </button>
          </div>

          {c.hiredBy && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-prestige/40 bg-prestige/10 px-3 py-2 text-sm">
              <span>„{c.hiredBy.company}“ ти възлага този курс. Караш със свой камион и плащаш {Math.round(c.hiredBy.share * 100)}% от наградата ({money(Math.round(c.rewardCents * c.hiredBy.share))}) на компанията при доставката.</span>
              <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => void api('/api/game/action', { type: 'declineJob', offerId: c.hiredBy!.offerId }).then(() => router.refresh(), (e: Error) => setError(e.message))}>Откажи</button>
            </div>
          )}
          {canAssign && !c.urgent && !c.tender && !c.reservedByOther && !c.hiredBy && (
            <div className="mt-3">
              <button type="button" className="inline-flex items-center gap-1.5 text-sm text-mist-300 hover:text-prestige" onClick={() => setHiring(true)}><BadgeCheck className="h-4 w-4" />Възложи на свободен шофьор срещу комисиона за касата</button>
            </div>
          )}
          {hiring && <HireDialog contract={{ id: c.id, goods: c.goods, rewardCents: c.rewardCents, origin: c.origin.name, destination: c.destination.name }} onClose={() => setHiring(false)} />}
          {c.featured && (
            <p className="mt-3 rounded-lg border border-gold-400/40 bg-gold-400/10 px-3 py-2 text-sm text-mist-200">
              Товарът на деня: по-добро заплащане и +{DAILY_LOAD.coins} ТрансКоин при доставка навреме. Взима се само цял — от първия, който го поеме.
            </p>
          )}
          {c.shared && (
            <p className="mt-3 rounded-lg border border-cyan-glow/40 bg-cyan-glow/5 px-3 py-2 text-sm text-mist-200">
              Общ товар на компанията: вземете го на части с камионите си. Ако всички части стигнат навреме, всеки получава +{Math.round(SHARED_LOAD.bonusShare * 100)}% от своята част и значка „Отборен товар“.
            </p>
          )}
          {c.canShare && <ShareButton contractId={c.id} tons={c.tons} />}
          {c.urgent && (
            <p className="mt-3 rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-mist-200">
              Спешна поръчка: камионът стига до {c.origin.name} за 1 минута, където и да е, а курсът върви ×{dec(c.speedFactor)} по-бързо. Може да я поеме всеки играч със свободен камион (по веднъж), докато не изтече от борсата.
            </p>
          )}
          {c.alreadyTaken ? (
            <p className="mt-4 text-sm text-profit">Вече сте поели тази спешна поръчка — следете я в „Автопарк“.</p>
          ) : c.opensAt ? (
            <p className="mt-4 text-sm text-prestige">VIP играчите поемат спешните доставки 5 минути по-рано. За всички се отваря в {c.opensAt}.</p>
          ) : c.reservedByOther ? (
            <p className="mt-4 text-sm text-mist-300">Друг играч е запазил тази поръчка до {c.reservedUntil}. След това отново е свободна.</p>
          ) : c.locked ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-prestige"><Lock className="h-4 w-4" />Достигнете ниво {c.minLevel}, за да поемате такива товари.</p>
          ) : c.reputationLocked ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-gold-400"><Star className="h-4 w-4" />Премиум поръчка — плаща повече, но е само за превозвачи с репутация {c.minReputation}+. Репутацията расте с всяка доставка навреме.</p>
          ) : c.missingLicences.length ? (
            <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-amber-sig">
              <BadgeCheck className="h-4 w-4" />Нужен е лиценз: {c.missingLicences.join(', ')}.
              <Link href="/game/licences" className="text-cyan-glow hover:underline">Към лицензите →</Link>
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <select className="input min-w-0 flex-1" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} aria-label="Превозно средство">
                  <option value="">— изберете превозно средство —</option>
                  {c.options.map((o) => (
                    <option key={o.vehicleId} value={o.vehicleId} disabled={!!o.error}>
                      {o.label}{o.error ? ` — ${o.error}` : o.part && !o.overloadPercent ? ` — част: ${dec(o.part.tons)} т` : ''}
                    </option>
                  ))}
                </select>
                <button className="btn-primary" disabled={!vehicleId || !!option?.error || busy || (needsOverload && !overload && !part)} onClick={accept}>
                  <ShieldCheck className="h-4 w-4" />{busy ? 'Изпращане…' : part ? `Вземи ${dec(part.tons)} т и изпрати` : 'Приеми и изпрати'}
                </button>
                <Link href={`/game/map?contract=${c.id}`} className="btn-ghost"><MapPinned className="h-4 w-4" />На картата</Link>
                {vip && !c.urgent && !c.reservedByMe && <ReserveButton contractId={c.id} />}
              </div>
              {option && !option.error && (option.rushMinutes != null || needsOverload) && (
                <div className="space-y-1.5 rounded-xl border border-amber-sig/30 bg-amber-sig/5 p-3 text-sm">
                  {insuranceLive && (
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-0.5" checked={insure} onChange={(e) => setInsure(e.target.checked)} />
                      <span>Застраховай товара — {money(Math.round((part ? part.rewardCents : c.rewardCents) * CARGO_INSURANCE.premiumShare))}. При закъснение връща {Math.round(CARGO_INSURANCE.covers * 100)} % от неустойката.</span>
                    </label>
                  )}
                  {option.rushMinutes != null && (
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-0.5" checked={rush} onChange={(e) => setRush(e.target.checked)} />
                      <span>Без задължителната почивка — пристига след ≈ {duration(option.rushMinutes)} вместо ≈ {duration(option.minutes)}. <span className="text-amber-sig">Риск от глоба при проверка на тахографа.</span></span>
                    </label>
                  )}
                  {needsOverload && (
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-0.5" checked={overload} onChange={(e) => setOverload(e.target.checked)} />
                      <span>{option.part ? 'Вместо част — натовари всичко' : 'Натовари'} с претоварване (+{option.overloadPercent}% над капацитета). <span className="text-amber-sig">Риск от глоба на кантар и по-бързо износване.</span></span>
                    </label>
                  )}
                </div>
              )}
              {c.ferry && (
                <p className="rounded-xl border border-cyan-glow/30 bg-cyan-glow/5 p-3 text-sm">
                  <span className="font-semibold text-cyan-glow">{c.ferry.note}: </span>
                  камионът чака на пристанището следващия ферибот (тръгват на всеки час), шофьорът почива на борда. Билет {money(c.ferry.ticketCents)}; за морето няма гориво и такси. Разписанието и цените са игрови данни.
                </p>
              )}
              {!!c.rail?.length && (
                <div className="space-y-1.5 rounded-xl border border-volt-500/30 bg-volt-500/5 p-3 text-sm">
                  <label className="flex items-start gap-2">
                    <input type="radio" name={`rail-${c.id}`} className="mt-0.5" checked={!rail} onChange={() => setRail('')} />
                    <span>По пътя</span>
                  </label>
                  {c.rail.map((r) => (
                    <label key={r.id} className="flex items-start gap-2">
                      <input type="radio" name={`rail-${c.id}`} className="mt-0.5" checked={rail === r.id} onChange={() => setRail(r.id)} />
                      <span><TrainFront className="mr-1 inline h-3.5 w-3.5 text-volt-400" /><b>{r.note}</b> ({int(r.km)} км с влак) — камионът се качва на влака, шофьорът почива, а за тези километри няма гориво, такси и износване. Билет {money(r.ticketCents)}; влаковете тръгват на всеки 30 мин (игрово разписание).</span>
                    </label>
                  ))}
                </div>
              )}
              {part && (
                <p className="rounded-xl border border-cyan-glow/30 bg-cyan-glow/5 p-3 text-sm">
                  <span className="font-semibold text-cyan-glow">Част от товара: </span>
                  камионът побира {dec(part.tons)} т от {dec(c.tons)} т — заплащане <span className="num font-semibold text-profit">{money(part.rewardCents)}</span> (делът от тоновете). Останалите {dec(Math.round((c.tons - part.tons) * 10) / 10)} т остават на борсата за други камиони.
                </p>
              )}
              {option && !option.error && (
                <div className="grid gap-2 text-sm sm:grid-cols-4">
                  <div className="rounded-lg bg-asphalt-800 px-3 py-2"><span className="text-mist-400">Празен курс </span><span className="num">≈ {int(option.emptyKm)} км{c.urgent && option.emptyKm > 0 ? ' · 1 мин' : ''}</span></div>
                  <div className="rounded-lg bg-asphalt-800 px-3 py-2"><span className="text-mist-400">{option.rented ? 'Наем ' : 'Разходи (оценка) '}</span><span className="num text-loss">{money(option.costCents)}</span></div>
                  <div className="rounded-lg bg-asphalt-800 px-3 py-2"><span className="text-mist-400">Печалба (оценка) </span><span className={`num ${shownProfit >= 0 ? 'text-profit' : 'text-loss'}`}>{money(shownProfit)}</span></div>
                  <div className={`rounded-lg px-3 py-2 ${shownMinutes > c.windowMinutes ? 'bg-loss/10 text-loss' : 'bg-asphalt-800'}`}>
                    <span className="text-mist-400">Пристигане след </span><span className="num">≈ {duration(shownMinutes)}</span>
                    {shownMinutes > c.windowMinutes && <span className="ml-1 inline-flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />риск от закъснение</span>}
                  </div>
                </div>
              )}
              {usable.length === 0 && <p className="text-sm text-amber-sig">Нито едно от вашите превозни средства не може да поеме тази поръчка. Причините са посочени в списъка.</p>}
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
        <Boxes className="h-4 w-4" />Сподели {dec(tons)} т с компанията — членовете го карат на части и всеки получава +{Math.round(SHARED_LOAD.bonusShare * 100)}%, ако всичко стигне навреме
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
      <button className="btn-ghost border-gold-400/40 text-gold-400" onClick={reserve} disabled={busy} title="VIP: само ти можеш да я поемеш следващите 10 минути">
        {busy ? '…' : 'Запази за 10 мин'}
      </button>
      {error && <span role="alert" className="text-xs text-loss">{error}</span>}
    </span>
  );
}
