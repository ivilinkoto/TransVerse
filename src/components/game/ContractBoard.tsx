'use client';

import { AlertTriangle, ArrowRight, BadgeCheck, Clock, Lock, MapPinned, Route, Search, ShieldCheck, Siren, Truck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Empty, type BadgeTone } from '@/components/ui';
import { api } from '@/lib/client/api';
import { dateTime, dec, duration, int, km, money } from '@/lib/format';
import type { CargoType } from '@/lib/game/cargo';

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
  /** Starts in a city where one of the player's free vehicles stands. */
  local: boolean;
  /** Urgent shipment from the game administration: listed first, driven faster. */
  urgent: boolean;
  /** Load of a tender of the player's company (only members see it). */
  tender: boolean;
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
  options: { vehicleId: string; label: string; error: string | null; emptyKm: number; costCents: number; rented: boolean; profitCents: number; minutes: number }[];
}

const CARGO_TONE: Record<CargoType, BadgeTone> = { pallets: 'blue', refrigerated: 'cyan', bulk: 'orange', container: 'gold', liquid: 'red', special: 'violet' };

type Sort = 'reward' | 'perKm' | 'distance' | 'expires';

export function ContractBoard({ contracts, cargoTypes, localCityNames, vip = false }: { contracts: BoardContract[]; cargoTypes: { id: string; label: string }[]; localCityNames: string[]; vip?: boolean }) {
  const [cargo, setCargo] = useState<string>('');
  const [query, setQuery] = useState('');
  const [doable, setDoable] = useState(false);
  const [sort, setSort] = useState<Sort>('reward');
  const [open, setOpen] = useState<string | null>(null);
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
        (!doable || (!c.locked && !c.alreadyTaken && !c.reservedByOther && !c.opensAt && !c.missingLicences.length && c.options.some((o) => !o.error))),
    );
    const key: Record<Sort, (c: BoardContract) => number> = {
      reward: (c) => -c.rewardCents,
      perKm: (c) => -c.rewardCents / c.distanceKm,
      distance: (c) => c.distanceKm,
      expires: (c) => new Date(c.expiresAt).getTime(),
    };
    // Own city first — jobs the player can take right now before the rest.
    // Urgent shipments first, then the player's own city.
    const takeable = (c: BoardContract) => !c.locked && !c.alreadyTaken && !c.reservedByOther && !c.opensAt && !c.missingLicences.length && c.options.some((o) => !o.error);
    const rank = (c: BoardContract) => (c.urgent ? 0 : c.tender && takeable(c) ? 1 : c.local ? (takeable(c) ? 1 : 2) : 3);
    return filtered.sort((a, b) => rank(a) - rank(b) || key[sort](a) - key[sort](b));
  }, [contracts, cargo, query, doable, sort]);

  return (
    <div className="space-y-4">
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
            <ContractRow key={c.id} contract={c} vip={vip} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ContractRow({ contract: c, vip, open, onToggle }: { contract: BoardContract; vip: boolean; open: boolean; onToggle: () => void }) {
  const router = useRouter();
  const usable = c.options.filter((o) => !o.error);
  const [vehicleId, setVehicleId] = useState(usable[0]?.vehicleId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const option = c.options.find((o) => o.vehicleId === vehicleId);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/game/action', { type: 'acceptContract', contractId: c.id, vehicleId });
      router.push('/game/fleet');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <li className={`panel overflow-hidden transition ${open ? 'border-volt-500/60' : c.urgent ? 'border-loss/60 hover:border-loss' : c.local ? 'border-gold-400/40 hover:border-gold-400/70' : 'hover:border-asphalt-500'} ${c.locked || c.missingLicences.length ? 'opacity-60' : ''}`}>
      <button className="grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 p-4 text-left sm:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_auto]" onClick={onToggle} aria-expanded={open}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={CARGO_TONE[c.cargoType]}>{c.cargoLabel}</Badge>
            <span className="truncate font-semibold">{c.goods}</span>
            <span className="num text-sm text-mist-400">{dec(c.tons)} т</span>
            {c.urgent && <Badge tone="red"><Siren className="h-3 w-3" />СПЕШНО · ×{dec(c.speedFactor)} по-бързо · до товара за 1 мин</Badge>}
            {c.tender && <Badge tone="violet">ТЪРГ НА КОМПАНИЯТА</Badge>}
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
          <div className="num text-[11px] text-mist-400">{dec(c.rewardCents / 100 / c.distanceKm)} €/км</div>
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
                      {o.label}{o.error ? ` — ${o.error}` : ''}
                    </option>
                  ))}
                </select>
                <button className="btn-primary" disabled={!vehicleId || !!option?.error || busy} onClick={accept}>
                  <ShieldCheck className="h-4 w-4" />{busy ? 'Изпращане…' : 'Приеми и изпрати'}
                </button>
                <Link href={`/game/map?contract=${c.id}`} className="btn-ghost"><MapPinned className="h-4 w-4" />На картата</Link>
                {vip && !c.urgent && !c.reservedByMe && <ReserveButton contractId={c.id} />}
              </div>
              {option && !option.error && (
                <div className="grid gap-2 text-sm sm:grid-cols-4">
                  <div className="rounded-lg bg-asphalt-800 px-3 py-2"><span className="text-mist-400">Празен курс </span><span className="num">≈ {int(option.emptyKm)} км{c.urgent && option.emptyKm > 0 ? ' · 1 мин' : ''}</span></div>
                  <div className="rounded-lg bg-asphalt-800 px-3 py-2"><span className="text-mist-400">{option.rented ? 'Наем ' : 'Разходи (оценка) '}</span><span className="num text-loss">{money(option.costCents)}</span></div>
                  <div className="rounded-lg bg-asphalt-800 px-3 py-2"><span className="text-mist-400">Печалба (оценка) </span><span className={`num ${option.profitCents >= 0 ? 'text-profit' : 'text-loss'}`}>{money(option.profitCents)}</span></div>
                  <div className={`rounded-lg px-3 py-2 ${option.minutes > c.windowMinutes ? 'bg-loss/10 text-loss' : 'bg-asphalt-800'}`}>
                    <span className="text-mist-400">Пристигане след </span><span className="num">≈ {duration(option.minutes)}</span>
                    {option.minutes > c.windowMinutes && <span className="ml-1 inline-flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />риск от закъснение</span>}
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
