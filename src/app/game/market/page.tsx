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
import { ActionButton } from '@/components/ui/ActionButton';
import { like } from 'drizzle-orm';
import { jobState } from '@/server/db/schema';
import { t as tr, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: tr('Пазар') };
}

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
  return <p className="mb-2 text-xs text-amber-sig">{tr('Товарите за тази надстройка изискват {0} —', LICENCES[need].label)}{' '}<Link href="/game/licences" className="text-cyan-glow hover:underline">{tr('лицензи')}</Link>.</p>;
}

export default async function MarketPage({ searchParams }: { searchParams: Promise<{ show?: string; sort?: string }> }) {
  await initLocale();
  const { db, user, company, now, features } = await gameContext();
  // v1.5: the models this player already test-drove (once each).
  const testDriven = new Set(features.test_drive ? (await db.select({ key: jobState.key }).from(jobState).where(like(jobState.key, `test-drive:${user.id}:%`))).map((r) => r.key.split(':')[2]!) : []);
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
      <PageHeader title={tr('Пазар на техника')} subtitle={tr('Нови превозни средства и ремаркета. Места в депата: {0} / {1}.', usedSlots, totalSlots)} help={tr('Купуват се от всеки играч — със или без компания. Ремаркетата не заемат място в депото.')} />
      {depotRows.length === 0 && (
        <p className="rounded-xl border border-gold-400/40 bg-gold-400/10 px-4 py-3 text-sm text-mist-200">
          {tr('Купената техника се паркира в депо. Първо открий депо в раздел')}{' '}<Link href="/game/logistics" className="font-semibold text-cyan-glow hover:underline">{tr('Автопарк → Депа')}</Link>.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label={tr('Вид техника')} active={show} items={SHOW.map((x) => ({ id: x.id, label: x.label, href: href({ show: x.id }) }))} />
        <nav className="flex flex-wrap items-center gap-1.5 sm:ml-auto" aria-label={tr('Подреждане')}>
          <span className="text-xs text-mist-400">{tr('Подреди:')}</span>
          {SORT.map((x) => <Link key={x.id} href={href({ sort: x.id })} aria-current={sort === x.id ? 'page' : undefined} className={`rounded-full border px-3 py-1 text-xs font-medium transition ${sort === x.id ? 'border-cyan-glow/50 bg-cyan-glow/10 text-cyan-glow' : 'border-asphalt-700 text-mist-400 hover:text-white'}`}>{show === 'used' ? USED_SORT_LABELS[x.id] : x.label}</Link>)}
        </nav>
      </div>
      {show === 'used' && (
        <section>
          <h2 className="mb-1 font-display text-lg font-bold">{tr('Употребявана техника от играчи')}</h2>
          <p className="mb-3 text-sm text-mist-400">{tr('По-евтино от новото — с пробега и състоянието, които има. Продавачът плаща 5% такса. Своята техника обявяваш от Автопарк → Сервиз.')}</p>
          <UsedListings listings={used} companyId={company.id} level={user.level} balanceCents={company.balanceCents} freeSlots={freeSlots} now={now} />
        </section>
      )}
      {showUnits && (
      <section>
        <h2 className="mb-3 font-display text-lg font-bold">{show === 'tractor' ? tr('Влекачи') : show === 'van' ? tr('Ванове') : show === 'rigid' ? tr('Соло камиони') : tr('Превозни средства за покупка')}</h2>
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {units.map((m) => {
            const reason = user.level < m.minLevel ? tr('Изисква ниво {0}.', m.minLevel) : company.balanceCents < m.priceCents ? tr('Недостатъчни средства.') : freeSlots <= 0 ? tr('Няма свободно място в депата.') : null;
            return (
              <Card key={m.id} className="flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-display text-lg font-bold">{tx(m.name)}</div>
                    <div className="text-xs text-mist-400">{tx(m.brand)}</div>
                  </div>
                  <div className="text-right">
                    <div className="num font-display text-lg font-bold text-gold-400">{money(m.priceCents)}</div>
                    <Badge tone={user.level >= m.minLevel ? 'green' : 'violet'}>{tr('ниво {0}', m.minLevel)}</Badge>
                  </div>
                </div>
                <div className="my-3 flex h-28 items-end rounded-xl bg-[linear-gradient(180deg,transparent_60%,rgba(255,255,255,0.04))] px-2">
                  {/* Tractors are drawn alone: the trailer is a separate purchase. */}
                  <VehicleIllustration modelId={m.id} color="#1d4ed8" className="max-h-28 w-full" />
                </div>
                {m.kind === 'tractor' && <p className="-mt-1 mb-3 text-xs text-amber-sig">{tr('Само влекач — ремаркето се купува отделно (раздел „Ремаркета“).')}</p>}
                <dl className="mb-4 grid grid-cols-3 gap-2 text-xs">
                  <div><dt className="text-mist-400">{tr('Тип')}</dt><dd>{tx(KIND[m.kind])}</dd></div>
                  <div><dt className="text-mist-400">{tr('Мощност')}</dt><dd className="num">{tr('{0} к.с.', m.powerHp)}</dd></div>
                  <div><dt className="text-mist-400">{tr('Оси')}</dt><dd className="num">{m.axles === 3 ? '6×4' : '4×2'}</dd></div>
                  <div><dt className="text-mist-400">{tr('Товар')}</dt><dd className="num">{m.kind === 'tractor' ? tr('с ремарке') : tr('{0} т · {1}', m.payloadTons, BODY_LABELS[m.body!])}</dd></div>
                  <div><dt className="text-mist-400">{m.electric ? tr('Ток · пробег') : tr('Разход')}</dt><dd className="num">{m.electric ? tr('{0}–{1} kWh · {2} км', m.electric.kwhEmpty, m.electric.kwhFull, m.electric.rangeKm) : tr('{0}–{1} л', m.fuelEmpty, m.fuelFull)}</dd></div>
                  <div><dt className="text-mist-400">{tr('Поддръжка')}</dt><dd className="num">{tr('{0} лв./км', (m.maintenanceCentsPerKm / 100).toFixed(2))}</dd></div>
                </dl>
                <LicenceHint body={m.body} held={held} />
                <div className="mt-auto space-y-3">
                  <BuyButton type="buyVehicle" modelId={m.id} depots={depotOptions} disabledReason={reason} label={tr('Купи')} />
                  {features.test_drive && !testDriven.has(m.id) && user.level >= m.minLevel && (
                    <ActionButton action={{ type: 'testDrive', modelId: m.id }} className="btn-ghost w-full justify-center text-sm" confirm={tr('Тест-драйв на {0} {1}: ти сядаш в него там, където е камионът ти, и караш един курс без наем. После се връща в салона.', m.brand, m.name)}>{tr('Тест-драйв')}</ActionButton>
                  )}
                  {features.leasing && m.priceCents >= LEASE.minPriceCents && (() => {
                    const t = leaseTerms(m.priceCents);
                    const leaseReason = user.level < m.minLevel ? tr('Изисква ниво {0}.', m.minLevel) : company.balanceCents < t.downCents ? tr('Недостатъчни средства за първата вноска.') : freeSlots <= 0 ? tr('Няма свободно място в депата.') : null;
                    return (
                      <div className="rounded-xl border border-asphalt-700 p-3">
                        <p className="mb-2 text-xs text-mist-300">
                          <b>{tr('Лизинг:')}</b>{' '}{tr('{0} сега и {1} седмични вноски по {2} (общо {3}). Вноските се теглят сами; при {4} пропуснати подред камионът се връща.', money(t.downCents), t.payments, money(t.weeklyCents), money(t.totalCents), LEASE.maxMissed)}
                        </p>
                        <BuyButton type="leaseVehicle" modelId={m.id} depots={depotOptions} disabledReason={leaseReason} label={tr('Вземи на лизинг')} />
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
        <h2 className="mb-1 font-display text-lg font-bold">{tr('Ремаркета')}</h2>
        <p className="mb-3 text-sm text-mist-400">{tr('Полуремаркетата се теглят от влекач. Прикачните ремаркета вървят зад соло камион със същата надстройка и почти удвояват товара му.')}</p>
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {order(TRAILERS).map((t) => {
            const reason = user.level < t.minLevel ? tr('Изисква ниво {0}.', t.minLevel) : company.balanceCents < t.priceCents ? tr('Недостатъчни средства.') : null;
            return (
              <Card key={t.id} className="flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-display text-lg font-bold">{tx(t.name)}</div>
                    <div className="text-xs text-mist-400">{tx(t.brand)} · {tx(BODY_LABELS[t.body])}</div>
                  </div>
                  <div className="text-right">
                    <div className="num font-display text-lg font-bold text-gold-400">{money(t.priceCents)}</div>
                    <Badge tone={user.level >= t.minLevel ? 'green' : 'violet'}>{tr('ниво {0}', t.minLevel)}</Badge>
                  </div>
                </div>
                <TrailerIllustration modelId={t.id} className="my-3 h-20 w-full" />
                <div className="mb-4 flex flex-wrap gap-3 text-xs text-mist-300">
                  <span className="num">{tr('{0} т', t.payloadTons)}</span><span>{tr('{0} оси', t.axles)}</span>{t.kind === 'drawbar' ? <Badge tone="cyan">{tr('прикачно — за соло камион')}</Badge> : <Badge tone="neutral">{tr('полуремарке — за влекач')}</Badge>}{t.requiresHeavyHaul && <Badge tone="violet">{tr('изисква тежък влекач 6×4')}</Badge>}
                </div>
                <LicenceHint body={t.body} held={held} />
                <div className="mt-auto"><BuyButton type="buyTrailer" modelId={t.id} depots={depotOptions} disabledReason={reason} label={tr('Купи')} /></div>
              </Card>
            );
          })}
        </div>
      </section>
      )}
    </div>
  );
}
