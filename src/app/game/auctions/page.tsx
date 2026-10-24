import { ArrowRight, Coins, Gavel, Timer, Trophy } from 'lucide-react';
import { AuctionBid, AuctionCountdown } from '@/components/game/AuctionLive';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { SelectAction } from '@/components/ui/SelectAction';
import { dateTime, km, money } from '@/lib/format';
import { AUCTION_RULES, floorBidCents, maxBidCents } from '@/lib/game/auctions';
import { CARGO, type CargoType } from '@/lib/game/cargo';
import { auctionsBoard } from '@/server/game/auctions';
import { gameContext } from '@/server/game/context';
import { BODY_LABELS, compatibilityError } from '@/server/game/deliveries';
import { WhyNot } from '@/components/game/WhyNot';
import { fleetView } from '@/server/game/queries';

export const metadata = { title: 'Специални товари' };

const STATUS: Record<string, { label: string; tone: 'green' | 'gold' | 'red' | 'neutral' }> = {
  awarded: { label: 'на път към победителя', tone: 'gold' },
  delivered: { label: 'доставен', tone: 'green' },
  forfeited: { label: 'изпуснат', tone: 'red' },
  no_bids: { label: 'без оферти', tone: 'neutral' },
};

export default async function AuctionsPage() {
  const { db, user, company, now } = await gameContext();
  const [board, fleet] = await Promise.all([auctionsBoard(db, company.id, now), fleetView(db, company.id)]);
  const next = AUCTION_RULES.hours.map((h) => `${String(h).padStart(2, '0')}:00`).join(', ');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Специални товари"
        subtitle={`Редки и скъпи товари на търг: всеки ден в ${next} за ${AUCTION_RULES.minutes} минути.`}
        help={`Наддава се надолу: всеки предлага на каква цена ще превози товара, и печели най-ниската. Новата оферта трябва да е поне ${Math.round(AUCTION_RULES.stepShare * 100)}% под най-ниската, но не под ${Math.round(AUCTION_RULES.floorShare * 100)}% от началната цена. Оферта в последната минута удължава търга с минута (до ${AUCTION_RULES.maxExtensions} пъти). Може да наддаваш, ако имаш камион за този товар (дори да е на път) и нужните лицензи. Победителят получава товара като лична поръчка и има ${AUCTION_RULES.sendHours} часа да изпрати камион — иначе губи товара и ${AUCTION_RULES.forfeitReputation} репутация. При доставка получава и ТрансКоин. Товарите са игрови данни.`}
      />

      {board.won.length > 0 && (
        <Card title={<span className="inline-flex items-center gap-2"><Trophy className="h-4 w-4 text-gold-400" />Спечелени — изпрати камион</span>}>
          <ul className="space-y-3">
            {board.won.map((w) => {
              const options = fleet.vehicles.map((v) => {
                const error = compatibilityError({ modelId: v.modelId, trailerModelId: v.trailer?.modelId ?? null, condition: v.condition, hasDriver: !!v.driver, status: v.status, trailerCondition: v.trailer?.condition ?? null }, { cargoType: w.cargoType, weightTons: w.weightTons, minLevel: 1 }, user.level);
                return { value: v.id, label: `${v.plate} · ${v.model.name} · ${v.city.nameBg}${error ? ' (не става)' : ''}`, disabled: !!error, error };
              });
              return (
                <li key={w.id} className="rounded-xl border border-gold-400/40 bg-gold-400/5 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{w.title} · {w.weightTons} т</span>
                    <span className="num">{money(w.winningBidCents ?? 0)} + {w.coins} TC</span>
                  </div>
                  <div className="text-mist-300">{w.from} <ArrowRight className="inline h-3 w-3" /> {w.to} · {km(w.distanceKm)} · изпрати до {dateTime(w.contract.expiresAt)}</div>
                  <div className="mt-2"><SelectAction label="Изпрати" ariaLabel={`Камион за ${w.title}`} value="" options={[{ value: '', label: '— избери камион —' }, ...options]} action={{ type: 'acceptContract', contractId: w.contract.id }} field="vehicleId" /></div>
                  <div className="mt-2"><WhyNot needs={[{ label: 'Надстройка', value: CARGO[w.cargoType as CargoType].bodies.map((b) => BODY_LABELS[b] ?? b).join(' или ') }, { label: 'Товар', value: `${w.weightTons} т` }]} blocked={options.filter((o) => o.error).map((o) => ({ label: o.label, error: o.error! }))} anyUsable={options.some((o) => !o.error)} /></div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {board.open.length === 0 ? (
        <Card><Empty icon={Gavel} title="Няма търг в момента">Следващият специален товар излиза в {next}.</Empty></Card>
      ) : (
        board.open.map((a) => {
          const max = maxBidCents(a.startPriceCents, a.lowest?.amount ?? null);
          const floor = floorBidCents(a.startPriceCents);
          const leading = a.lowest?.companyId === company.id;
          return (
            <section key={a.id} className="panel overflow-hidden">
              <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="gold"><Gavel className="h-3.5 w-3.5" />ТЪРГ</Badge>
                    <Badge tone="neutral">{CARGO[a.cargoType as CargoType].label}</Badge>
                    <span className="inline-flex items-center gap-1 text-sm text-mist-300"><Timer className="h-4 w-4" /><AuctionCountdown endsAt={a.endsAt.toISOString()} /></span>
                  </div>
                  <h2 className="mt-2 font-display text-2xl font-bold">{a.title}</h2>
                  <p className="text-mist-300">{a.goods} · {a.weightTons} т · {a.from} <ArrowRight className="inline h-3.5 w-3.5" /> {a.to} · {km(a.distanceKm)}</p>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <div><dt className="label">Начална цена</dt><dd className="num">{money(a.startPriceCents)}</dd></div>
                    <div><dt className="label">Най-ниска оферта</dt><dd className="num text-profit">{a.lowest ? money(a.lowest.amount) : '—'}</dd></div>
                    <div><dt className="label">Води</dt><dd className="truncate">{a.lowest ? (leading ? 'ти' : a.lowest.username) : '—'}</dd></div>
                    <div><dt className="label">Бонус</dt><dd className="num inline-flex items-center gap-1 text-cyan-glow"><Coins className="h-3.5 w-3.5" />{a.coins} TC</dd></div>
                  </dl>
                  <p className="mt-3 text-xs text-mist-400">{a.bids} {a.bids === 1 ? 'оферта' : 'оферти'}{a.myBid ? ` · твоята: ${money(a.myBid)}` : ''}</p>
                </div>
                <div className="rounded-2xl border border-asphalt-700 bg-asphalt-850 p-4">
                  {leading ? <p className="mb-2 text-sm text-profit">Ти водиш. Можеш да свалиш още цената, ако някой те изпревари.</p> : null}
                  <AuctionBid auctionId={a.id} maxEur={Math.floor(max / 100)} floorEur={Math.ceil(floor / 100)} />
                </div>
              </div>
            </section>
          );
        })
      )}

      {board.recent.length > 0 && (
        <Card title="Последни търгове">
          <ul className="divide-y divide-asphalt-800 text-sm">
            {board.recent.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0"><span className="font-medium">{a.title}</span> <span className="text-mist-400">· {a.from} → {a.to}</span></span>
                <span className="flex items-center gap-2">
                  {a.winningBidCents ? <span className="num text-xs text-mist-300">{money(a.winningBidCents)}{a.lowest ? ` · ${a.lowest.username}` : ''}</span> : null}
                  <Badge tone={STATUS[a.status]?.tone ?? 'neutral'}>{STATUS[a.status]?.label ?? a.status}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
