import { Gauge, MapPin, Store, UserRound } from 'lucide-react';
import { Badge, Card, Empty, Meter } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { TrailerIllustration, VehicleIllustration } from '@/components/vehicles/VehicleIllustration';
import { int, money } from '@/lib/format';
import { powerUnitModel, trailerModel } from '@/lib/game/catalog';
import type { openListings } from '@/server/game/used-market';

type Listing = Awaited<ReturnType<typeof openListings>>[number];

/** Used vehicles and trailers offered by other players. */
export function UsedListings({ listings, companyId, level, balanceCents, freeSlots, now }: { listings: Listing[]; companyId: string; level: number; balanceCents: number; freeSlots: number; now: Date }) {
  if (!listings.length)
    return (
      <Empty icon={Store} title="Няма обяви в момента">
        Когато играч обяви камион или ремарке за продажба, ще го видиш тук. Своята техника обявяваш от Автопарк → Сервиз.
      </Empty>
    );
  return (
    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
      {listings.map((l) => {
        const model = l.kind === 'vehicle' ? powerUnitModel(l.modelId) : trailerModel(l.modelId);
        const mine = l.sellerCompanyId === companyId;
        const off = Math.round((1 - l.priceCents / l.newPriceCents) * 100);
        const ageMonths = Math.max(0, Math.round((now.getTime() - l.purchasedAt.getTime()) / (30 * 86_400_000)));
        const reason = mine ? 'Това е твоя обява.' : level < model.minLevel ? `Изисква ниво ${model.minLevel}.` : balanceCents < l.priceCents ? 'Недостатъчни средства.' : l.kind === 'vehicle' && freeSlots <= 0 ? 'Няма свободно място в депата.' : null;
        return (
          <Card key={l.id} className="flex flex-col">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-display text-lg font-bold">{model.name}</div>
                <div className="text-xs text-mist-400">{model.brand} · <span className="font-mono">{l.plate}</span></div>
              </div>
              <div className="shrink-0 text-right">
                <div className="num font-display text-lg font-bold text-gold-400">{money(l.priceCents)}</div>
                {off > 0 && <Badge tone="green">−{off}% от новата</Badge>}
              </div>
            </div>
            <div className="my-3 flex h-24 items-end rounded-xl bg-[linear-gradient(180deg,transparent_60%,rgba(255,255,255,0.04))] px-2">
              {l.kind === 'vehicle' ? <VehicleIllustration modelId={l.modelId} color={l.color ?? undefined} className="max-h-24 w-full" /> : <TrailerIllustration modelId={l.modelId} className="max-h-20 w-full" />}
            </div>
            <div className="mb-1 flex justify-between text-xs text-mist-400"><span>Състояние</span><span className="num">{Math.round(l.condition)}%</span></div>
            <Meter value={l.condition} />
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              {l.odometerKm != null && <div className="flex items-center gap-1.5"><Gauge className="h-3.5 w-3.5 text-mist-400" />{int(l.odometerKm)} км</div>}
              <div className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-mist-400" />{l.city.nameBg}, {l.city.countryCode}</div>
              <div className="flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5 text-mist-400" />{l.seller}</div>
              <div className="text-mist-400">{ageMonths ? `на ${ageMonths} мес.` : 'почти нов'}{l.upgrades.length ? ` · ${l.upgrades.length} подобрения` : ''}</div>
            </dl>
            <p className="mt-2 text-[11px] text-mist-400">Нов: {money(l.newPriceCents)}. Остава в {l.city.nameBg} — оттам поема първата си поръчка.</p>
            <div className="mt-auto pt-3">
              {mine ? (
                <ActionButton action={{ type: 'cancelListing', listingId: l.id }} className="btn-ghost w-full">Свали обявата</ActionButton>
              ) : (
                <ActionButton action={{ type: 'buyListing', listingId: l.id }} className="btn-primary w-full" confirm={`Купуваш ${model.name} за ${money(l.priceCents)}?`} disabled={!!reason}>
                  {reason ?? `Купи · ${money(l.priceCents)}`}
                </ActionButton>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
