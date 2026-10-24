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
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Специални товари') };
}

const STATUS: Record<string, { label: string; tone: 'green' | 'gold' | 'red' | 'neutral' }> = {
  awarded: { label: 'на път към победителя', tone: 'gold' },
  delivered: { label: 'доставен', tone: 'green' },
  forfeited: { label: 'изпуснат', tone: 'red' },
  no_bids: { label: 'без оферти', tone: 'neutral' },
};

export default async function AuctionsPage() {
  await initLocale();
  const { db, user, company, now } = await gameContext();
  const [board, fleet] = await Promise.all([auctionsBoard(db, company.id, now), fleetView(db, company.id)]);
  const next = AUCTION_RULES.hours.map((h) => `${String(h).padStart(2, '0')}:00`).join(', ');

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('Специални товари')}
        subtitle={t('Редки и скъпи товари на търг: всеки ден в {0} за {1} минути.', next, AUCTION_RULES.minutes)}
        help={t('Наддава се надолу: всеки предлага на каква цена ще превози товара, и печели най-ниската. Новата оферта трябва да е поне {0}% под най-ниската, но не под {1}% от началната цена. Оферта в последната минута удължава търга с минута (до {2} пъти). Може да наддаваш, ако имаш камион за този товар (дори да е на път) и нужните лицензи. Победителят получава товара като лична поръчка и има {3} часа да изпрати камион — иначе губи товара и {4} репутация. При доставка получава и ТрансКоин. Товарите са игрови данни.', Math.round(AUCTION_RULES.stepShare * 100), Math.round(AUCTION_RULES.floorShare * 100), AUCTION_RULES.maxExtensions, AUCTION_RULES.sendHours, AUCTION_RULES.forfeitReputation)}
      />

      {board.won.length > 0 && (
        <Card title={<span className="inline-flex items-center gap-2"><Trophy className="h-4 w-4 text-gold-400" />{t('Спечелени — изпрати камион')}</span>}>
          <ul className="space-y-3">
            {board.won.map((w) => {
              const options = fleet.vehicles.map((v) => {
                const error = compatibilityError({ modelId: v.modelId, trailerModelId: v.trailer?.modelId ?? null, condition: v.condition, hasDriver: !!v.driver, status: v.status, trailerCondition: v.trailer?.condition ?? null }, { cargoType: w.cargoType, weightTons: w.weightTons, minLevel: 1 }, user.level);
                return { value: v.id, label: `${v.plate} · ${v.model.name} · ${v.city.nameBg}${error ? t(' (не става)') : ''}`, disabled: !!error, error };
              });
              return (
                <li key={w.id} className="rounded-xl border border-gold-400/40 bg-gold-400/5 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{t('{0} · {1} т', w.title, w.weightTons)}</span>
                    <span className="num">{money(w.winningBidCents ?? 0)} + {tx(w.coins)} TC</span>
                  </div>
                  <div className="text-mist-300">{tx(w.from)} <ArrowRight className="inline h-3 w-3" />{' '}{t('{0} · {1} · изпрати до {2}', w.to, km(w.distanceKm), dateTime(w.contract.expiresAt))}</div>
                  <div className="mt-2"><SelectAction label={t('Изпрати')} ariaLabel={t('Камион за {0}', w.title)} value="" options={[{ value: '', label: t('— избери камион —') }, ...options]} action={{ type: 'acceptContract', contractId: w.contract.id }} field="vehicleId" /></div>
                  <div className="mt-2"><WhyNot needs={[{ label: t('Надстройка'), value: CARGO[w.cargoType as CargoType].bodies.map((b) => BODY_LABELS[b] ?? b).join(t(' или ')) }, { label: t('Товар'), value: t('{0} т', w.weightTons) }]} blocked={options.filter((o) => o.error).map((o) => ({ label: o.label, error: o.error! }))} anyUsable={options.some((o) => !o.error)} /></div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {board.open.length === 0 ? (
        <Card><Empty icon={Gavel} title={t('Няма търг в момента')}>{t('Следващият специален товар излиза в {0}.', next)}</Empty></Card>
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
                    <Badge tone="gold"><Gavel className="h-3.5 w-3.5" />{t('ТЪРГ')}</Badge>
                    <Badge tone="neutral">{tx(CARGO[a.cargoType as CargoType].label)}</Badge>
                    <span className="inline-flex items-center gap-1 text-sm text-mist-300"><Timer className="h-4 w-4" /><AuctionCountdown endsAt={a.endsAt.toISOString()} /></span>
                  </div>
                  <h2 className="mt-2 font-display text-2xl font-bold">{tx(a.title)}</h2>
                  <p className="text-mist-300">{t('{0} · {1} т · {2}', a.goods, a.weightTons, a.from)}{' '}<ArrowRight className="inline h-3.5 w-3.5" /> {tx(a.to)} · {km(a.distanceKm)}</p>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <div><dt className="label">{t('Начална цена')}</dt><dd className="num">{money(a.startPriceCents)}</dd></div>
                    <div><dt className="label">{t('Най-ниска оферта')}</dt><dd className="num text-profit">{a.lowest ? money(a.lowest.amount) : '—'}</dd></div>
                    <div><dt className="label">{t('Води')}</dt><dd className="truncate">{a.lowest ? (leading ? t('ти') : a.lowest.username) : '—'}</dd></div>
                    <div><dt className="label">{t('Бонус')}</dt><dd className="num inline-flex items-center gap-1 text-cyan-glow"><Coins className="h-3.5 w-3.5" />{tx(a.coins)} TC</dd></div>
                  </dl>
                  <p className="mt-3 text-xs text-mist-400">{tx(a.bids)} {a.bids === 1 ? t('оферта') : t('оферти')}{a.myBid ? t(' · твоята: {0}', money(a.myBid)) : ''}</p>
                </div>
                <div className="rounded-2xl border border-asphalt-700 bg-asphalt-850 p-4">
                  {leading ? <p className="mb-2 text-sm text-profit">{t('Ти водиш. Можеш да свалиш още цената, ако някой те изпревари.')}</p> : null}
                  <AuctionBid auctionId={a.id} maxEur={Math.floor(max / 100)} floorEur={Math.ceil(floor / 100)} />
                </div>
              </div>
            </section>
          );
        })
      )}

      {board.recent.length > 0 && (
        <Card title={t('Последни търгове')}>
          <ul className="divide-y divide-asphalt-800 text-sm">
            {board.recent.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0"><span className="font-medium">{tx(a.title)}</span> <span className="text-mist-400">· {tx(a.from)} → {tx(a.to)}</span></span>
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
