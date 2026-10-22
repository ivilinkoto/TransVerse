import Link from 'next/link';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { BuyButton } from '@/components/game/BuyButton';
import { LICENCES, type LicenceId } from '@/lib/game/licences';
import { heldLicences } from '@/server/game/licences';
import { fleetCapacity } from '@/server/game/fleet';
import { ECONOMY } from '@/lib/game/economy';
import { Badge, Card, PageHeader, Segmented } from '@/components/ui';
import { TrailerIllustration, VehicleIllustration } from '@/components/vehicles/VehicleIllustration';
import { money } from '@/lib/format';
import { LEASE, leaseTerms } from '@/lib/game/leasing';
import { POWER_UNITS, TRAILERS } from '@/lib/game/catalog';
import { cities, depots, vehicles } from '@/server/db/schema';
import { BODY_LABELS } from '@/server/game/deliveries';
import { gameContext } from '@/server/game/context';
import { openListings } from '@/server/game/used-market';
import { UsedListings } from '@/components/game/UsedListings';

export const metadata = { title: 'Пазар' };

const KIND = { van: 'Ван', rigid: 'Соло камион', tractor: 'Влекач' } as const;

/** What the market shows (URL ?show=…) and in which order (?sort=…). */
const SHOW = [
  { id: 'all', label: 'Всичко' },
  { id: 'used', label: 'Употребявани' },
  { id: 'van', label: 'Ванове' },
  { id: 'rigid', label: 'Соло камиони' },
  { id: 'tractor', label: 'Влекачи' },
  { id: 'trailers', label: 'Ремаркета' },
] as const;
const SORT = [
  { id: 'price_asc', label: 'Цена ↑' },
  { id: 'price_desc', label: 'Цена ↓' },
  { id: 'level', label: 'Ниво' },
] as const;
type Show = (typeof SHOW)[number]['id'];
/** The same three sort buttons, read differently for used listings. */
const USED_SORT_LABELS = { price_asc: 'Най-евтини', price_desc: 'Най-нови обяви', level: 'Най-добро състояние' } as const;
type SortId = (typeof SORT)[number]['id'];

/** Licence needed for the cargo a body type carries (shown as a hint, buying is still allowed). */
const BODY_LICENCE: Record<string, LicenceId> = { reefer: 'reefer', tanker: 'adr', lowbed: 'oversize' };

function LicenceHint({ body, held }: { body: string | null | undefined; held: Set<LicenceId> }) {
  const need = body ? BODY_LICENCE[body] : undefined;
  if (!need || held.has(need)) return null;
  return <p className="mb-2 text-xs text-amber-sig">Товарите за тази надстройка изискват {LICENCES[need].label} — <Link href="/game/licences" className="text-cyan-glow hover:underline">лицензи</Link>.</p>;
}

export default async function MarketPage({ searchParams }: { searchParams: Promise<{ show?: string; sort?: string }> }) {
  const { db, user, company, now, features } = await gameContext();
  const params = await searchParams;
  const show: Show = SHOW.some((x) => x.id === params.show) ? (params.show as Show) : 'all';
  const sort: SortId = SORT.some((x) => x.id === params.sort) ? (params.sort as SortId) : 'price_asc';
  const order = <T extends { priceCents: number; minLevel: number }>(list: readonly T[]) =>
    [...list].sort((a, b) => (sort === 'price_desc' ? b.priceCents - a.priceCents : sort === 'level' ? a.minLevel - b.minLevel || a.priceCents - b.priceCents : a.priceCents - b.priceCents));
  // Electric models come with v1.4 (staff see them earlier).
  const units = order(POWER_UNITS.filter((m) => (show === 'all' || m.kind === show) && (!m.electric || features.electric)));
  const showUnits = show === 'all' || show === 'van' || show === 'rigid' || show === 'tractor';
  const href = (next: Partial<{ show: Show; sort: SortId }>) => `/game/market?show=${next.show ?? show}&sort=${next.sort ?? sort}`;
  const held = await heldLicences(db, user.id);
  const depotRows = await db
    .select({ cityId: depots.cityId, name: cities.nameBg, slots: depots.slots })
    .from(depots)
    .innerJoin(cities, eq(cities.id, depots.cityId))
    .where(eq(depots.companyId, company.id));
  const { used: usedSlots, slots: totalSlots } = await fleetCapacity(db, company.id);
  const freeSlots = totalSlots - usedSlots;
  const depotOptions = depotRows.map((d) => ({ cityId: d.cityId, name: d.name, free: freeSlots }));
  const used = show === 'used' ? await openListings(db, { sort: sort === 'price_asc' ? 'cheap' : sort === 'level' ? 'condition' : 'new' }) : [];

  return (
    <div className="space-y-6">
      <PageHeader title="Пазар на техника" subtitle={`Нови превозни средства и ремаркета. Места в депата: ${usedSlots} / ${totalSlots}.`} help="Купуват се от всеки играч — със или без компания. Ремаркетата не заемат място в депото." />
      {depotRows.length === 0 && (
        <p className="rounded-xl border border-gold-400/40 bg-gold-400/10 px-4 py-3 text-sm text-mist-200">
          Купената техника се паркира в депо. Първо открий депо в раздел <Link href="/game/logistics" className="font-semibold text-cyan-glow hover:underline">Автопарк → Депа</Link>.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Вид техника" active={show} items={SHOW.map((x) => ({ id: x.id, label: x.label, href: href({ show: x.id }) }))} />
        <nav className="flex flex-wrap items-center gap-1.5 sm:ml-auto" aria-label="Подреждане">
          <span className="text-xs text-mist-400">Подреди:</span>
          {SORT.map((x) => <Link key={x.id} href={href({ sort: x.id })} aria-current={sort === x.id ? 'page' : undefined} className={`rounded-full border px-3 py-1 text-xs font-medium transition ${sort === x.id ? 'border-cyan-glow/50 bg-cyan-glow/10 text-cyan-glow' : 'border-asphalt-700 text-mist-400 hover:text-white'}`}>{show === 'used' ? USED_SORT_LABELS[x.id] : x.label}</Link>)}
        </nav>
      </div>
      {show === 'used' && (
        <section>
          <h2 className="mb-1 font-display text-lg font-bold">Употребявана техника от играчи</h2>
          <p className="mb-3 text-sm text-mist-400">По-евтино от новото — с пробега и състоянието, които има. Продавачът плаща 5% такса. Своята техника обявяваш от Автопарк → Сервиз.</p>
          <UsedListings listings={used} companyId={company.id} level={user.level} balanceCents={company.balanceCents} freeSlots={freeSlots} now={now} />
        </section>
      )}
      {showUnits && (
      <section>
        <h2 className="mb-3 font-display text-lg font-bold">{show === 'tractor' ? 'Влекачи' : show === 'van' ? 'Ванове' : show === 'rigid' ? 'Соло камиони' : 'Превозни средства за покупка'}</h2>
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {units.map((m) => {
            const reason = user.level < m.minLevel ? `Изисква ниво ${m.minLevel}.` : company.balanceCents < m.priceCents ? 'Недостатъчни средства.' : freeSlots <= 0 ? 'Няма свободно място в депата.' : null;
            return (
              <Card key={m.id} className="flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-display text-lg font-bold">{m.name}</div>
                    <div className="text-xs text-mist-400">{m.brand}</div>
                  </div>
                  <div className="text-right">
                    <div className="num font-display text-lg font-bold text-gold-400">{money(m.priceCents)}</div>
                    <Badge tone={user.level >= m.minLevel ? 'green' : 'violet'}>ниво {m.minLevel}</Badge>
                  </div>
                </div>
                <div className="my-3 flex h-28 items-end rounded-xl bg-[linear-gradient(180deg,transparent_60%,rgba(255,255,255,0.04))] px-2">
                  {/* Tractors are drawn alone: the trailer is a separate purchase. */}
                  <VehicleIllustration modelId={m.id} color="#1d4ed8" className="max-h-28 w-full" />
                </div>
                {m.kind === 'tractor' && <p className="-mt-1 mb-3 text-xs text-amber-sig">Само влекач — ремаркето се купува отделно (раздел „Ремаркета“).</p>}
                <dl className="mb-4 grid grid-cols-3 gap-2 text-xs">
                  <div><dt className="text-mist-400">Тип</dt><dd>{KIND[m.kind]}</dd></div>
                  <div><dt className="text-mist-400">Мощност</dt><dd className="num">{m.powerHp} к.с.</dd></div>
                  <div><dt className="text-mist-400">Оси</dt><dd className="num">{m.axles === 3 ? '6×4' : '4×2'}</dd></div>
                  <div><dt className="text-mist-400">Товар</dt><dd className="num">{m.kind === 'tractor' ? 'с ремарке' : `${m.payloadTons} т · ${BODY_LABELS[m.body!]}`}</dd></div>
                  <div><dt className="text-mist-400">{m.electric ? 'Ток · пробег' : 'Разход'}</dt><dd className="num">{m.electric ? `${m.electric.kwhEmpty}–${m.electric.kwhFull} kWh · ${m.electric.rangeKm} км` : `${m.fuelEmpty}–${m.fuelFull} л`}</dd></div>
                  <div><dt className="text-mist-400">Поддръжка</dt><dd className="num">{(m.maintenanceCentsPerKm / 100).toFixed(2)} лв./км</dd></div>
                </dl>
                <LicenceHint body={m.body} held={held} />
                <div className="mt-auto space-y-3">
                  <BuyButton type="buyVehicle" modelId={m.id} depots={depotOptions} disabledReason={reason} label="Купи" />
                  {features.leasing && m.priceCents >= LEASE.minPriceCents && (() => {
                    const t = leaseTerms(m.priceCents);
                    const leaseReason = user.level < m.minLevel ? `Изисква ниво ${m.minLevel}.` : company.balanceCents < t.downCents ? 'Недостатъчни средства за първата вноска.' : freeSlots <= 0 ? 'Няма свободно място в депата.' : null;
                    return (
                      <div className="rounded-xl border border-asphalt-700 p-3">
                        <p className="mb-2 text-xs text-mist-300">
                          <b>Лизинг:</b> {money(t.downCents)} сега и {t.payments} седмични вноски по {money(t.weeklyCents)} (общо {money(t.totalCents)}). Вноските се теглят сами; при {LEASE.maxMissed} пропуснати подред камионът се връща.
                        </p>
                        <BuyButton type="leaseVehicle" modelId={m.id} depots={depotOptions} disabledReason={leaseReason} label="Вземи на лизинг" />
                      </div>
                    );
                  })()}
                </div>
              </Card>
            );
          })}
        </div>
      </section>
      )}
      {(show === 'all' || show === 'trailers') && (
      <section>
        <h2 className="mb-1 font-display text-lg font-bold">Ремаркета</h2>
        <p className="mb-3 text-sm text-mist-400">Полуремаркетата се теглят от влекач. Прикачните ремаркета вървят зад соло камион със същата надстройка и почти удвояват товара му.</p>
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {order(TRAILERS).map((t) => {
            const reason = user.level < t.minLevel ? `Изисква ниво ${t.minLevel}.` : company.balanceCents < t.priceCents ? 'Недостатъчни средства.' : null;
            return (
              <Card key={t.id} className="flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-display text-lg font-bold">{t.name}</div>
                    <div className="text-xs text-mist-400">{t.brand} · {BODY_LABELS[t.body]}</div>
                  </div>
                  <div className="text-right">
                    <div className="num font-display text-lg font-bold text-gold-400">{money(t.priceCents)}</div>
                    <Badge tone={user.level >= t.minLevel ? 'green' : 'violet'}>ниво {t.minLevel}</Badge>
                  </div>
                </div>
                <TrailerIllustration modelId={t.id} className="my-3 h-20 w-full" />
                <div className="mb-4 flex flex-wrap gap-3 text-xs text-mist-300">
                  <span className="num">{t.payloadTons} т</span><span>{t.axles} оси</span>{t.kind === 'drawbar' ? <Badge tone="cyan">прикачно — за соло камион</Badge> : <Badge tone="neutral">полуремарке — за влекач</Badge>}{t.requiresHeavyHaul && <Badge tone="violet">изисква тежък влекач 6×4</Badge>}
                </div>
                <LicenceHint body={t.body} held={held} />
                <div className="mt-auto"><BuyButton type="buyTrailer" modelId={t.id} depots={depotOptions} disabledReason={reason} label="Купи" /></div>
              </Card>
            );
          })}
        </div>
      </section>
      )}
    </div>
  );
}
