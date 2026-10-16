import { and, eq, isNull, sql } from 'drizzle-orm';
import { BuyButton } from '@/components/game/BuyButton';
import { Badge, Card, PageHeader } from '@/components/ui';
import { TrailerIllustration, VehicleIllustration } from '@/components/vehicles/VehicleIllustration';
import { money } from '@/lib/format';
import { POWER_UNITS, TRAILERS } from '@/lib/game/catalog';
import { cities, depots, vehicles } from '@/server/db/schema';
import { BODY_LABELS } from '@/server/game/deliveries';
import { gameContext } from '@/server/game/context';

export const metadata = { title: 'Пазар' };

const KIND = { van: 'Ван', rigid: 'Соло камион', tractor: 'Влекач' } as const;
const DEMO_TRAILER: Record<string, string | undefined> = { 'danubia-t440': 'curtain-13', 'danubia-t500-eco': 'reefer-13', 'rila-xt620': 'lowbed-4' };

export default async function MarketPage() {
  const { db, user, company } = await gameContext();
  const depotRows = await db
    .select({ cityId: depots.cityId, name: cities.nameBg, slots: depots.slots })
    .from(depots)
    .innerJoin(cities, eq(cities.id, depots.cityId))
    .where(eq(depots.companyId, company.id));
  const [{ used = 0 } = {}] = await db.select({ used: sql<number>`count(*)::int` }).from(vehicles).where(and(eq(vehicles.companyId, company.id), isNull(vehicles.soldAt)));
  const totalSlots = depotRows.reduce((s, d) => s + d.slots, 0);
  const freeSlots = totalSlots - used;
  const depotOptions = depotRows.map((d) => ({ cityId: d.cityId, name: d.name, free: freeSlots }));

  return (
    <div className="space-y-8">
      <PageHeader title="Пазар на техника" subtitle={`Нови превозни средства и ремаркета. Капацитет на депата: ${used} / ${totalSlots} превозни средства. Ремаркетата не заемат място.`} />
      <section>
        <h2 className="mb-3 font-display text-lg font-bold">Превозни средства</h2>
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {POWER_UNITS.map((m) => {
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
                  <VehicleIllustration modelId={m.id} trailerModelId={DEMO_TRAILER[m.id]} color="#1d4ed8" className="max-h-28 w-full" />
                </div>
                <dl className="mb-4 grid grid-cols-3 gap-2 text-xs">
                  <div><dt className="text-mist-400">Тип</dt><dd>{KIND[m.kind]}</dd></div>
                  <div><dt className="text-mist-400">Мощност</dt><dd className="num">{m.powerHp} к.с.</dd></div>
                  <div><dt className="text-mist-400">Оси</dt><dd className="num">{m.axles === 3 ? '6×4' : '4×2'}</dd></div>
                  <div><dt className="text-mist-400">Товар</dt><dd className="num">{m.kind === 'tractor' ? 'с ремарке' : `${m.payloadTons} т · ${BODY_LABELS[m.body!]}`}</dd></div>
                  <div><dt className="text-mist-400">Разход</dt><dd className="num">{m.fuelEmpty}–{m.fuelFull} л</dd></div>
                  <div><dt className="text-mist-400">Поддръжка</dt><dd className="num">{(m.maintenanceCentsPerKm / 100).toFixed(2)} €/км</dd></div>
                </dl>
                <div className="mt-auto"><BuyButton type="buyVehicle" modelId={m.id} depots={depotOptions} disabledReason={reason} label="Купи" /></div>
              </Card>
            );
          })}
        </div>
      </section>
      <section>
        <h2 className="mb-3 font-display text-lg font-bold">Полуремаркета</h2>
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {TRAILERS.map((t) => {
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
                  <span className="num">{t.payloadTons} т</span><span>{t.axles} оси</span>{t.requiresHeavyHaul && <Badge tone="violet">изисква тежък влекач 6×4</Badge>}
                </div>
                <div className="mt-auto"><BuyButton type="buyTrailer" modelId={t.id} depots={depotOptions} disabledReason={reason} label="Купи" /></div>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
