import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { FormAction } from '@/components/ui/FormAction';
import { TrainArt } from '@/components/game/TrainArt';
import { dateTime, duration, int, money } from '@/lib/format';
import { linesFrom, LOCO_IDS, LOCOS, terminal, TRAINS, WAGON_TYPES, WAGONS, wagonCount, type WagonType } from '@/lib/game/trains';
import { gameContext } from '@/server/game/context';
import { reasonText, trainsView } from '@/server/game/trains';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Влакове') };
}

const WAGON_ICON: Record<WagonType, string> = { container: '📦', tank: '🛢️', covered: '🚃', hopper: '🌾' };
const place = (id: number) => tx(terminal(id)?.name ?? '');

/** 1.3.3 „Жп линия“: my trains, the block-train orders at their terminals, and a new train. */
export default async function TrainsPage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.trains) notFound();
  const v = await trainsView(db, user.id, now);
  const locked = user.level < v.limits.minLevel;
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('Влакове')}
        subtitle={t('Собствени товарни влакове по истински жп линии — големи товари между товарните гари.')}
        help={t('Влакът кара само между товарни гари. На всяка гара има поръчки за блок-влакове ({0}–{1} т), нови на всеки {2} часа. Таксата за линията и енергията се плащат при тръгване, а поръчката — при пристигане. Линиите и разстоянията са истински; цените и поръчките са игрови данни.', TRAINS.tons.min, TRAINS.tons.max, TRAINS.windowHours)}
      />
      <section className="bus-bar flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4" data-testid="train-summary">
        <p className="text-sm text-mist-200">
          {v.company
            ? <>🤝 {t('В компания си: +{0}% за всяка поръчка, −{1}% такса за линията и до {2} влака.', Math.round(TRAINS.company.payBonus * 100), Math.round(TRAINS.company.trackDiscount * 100), v.limits.maxTrains)}</>
            : <>💡 {t('В компания: влакове от ниво {0}, +{1}% за поръчките, −{2}% такса за линията и още един влак.', TRAINS.company.minLevel, Math.round(TRAINS.company.payBonus * 100), Math.round(TRAINS.company.trackDiscount * 100))}</>}
        </p>
        <p className="text-xs text-mist-400">{t('{0} от {1} влака', v.trains.length, v.limits.maxTrains)}</p>
      </section>

      <ul className="space-y-3" data-testid="trains">
        {v.trains.map((tr) => {
          const loco = LOCOS[tr.loco];
          const list = WAGON_TYPES.flatMap((k) => Array.from({ length: tr.wagons[k] ?? 0 }, () => k));
          const run = tr.run;
          const progress = run ? Math.min(1, Math.max(0, (now.getTime() - new Date(run.departAt).getTime()) / (new Date(run.arriveAt).getTime() - new Date(run.departAt).getTime()))) : 0;
          const free = loco.maxWagons - wagonCount(tr.wagons);
          return (
            <li key={tr.id} className="bus-card space-y-3 rounded-3xl p-4" data-testid="train">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-lg font-bold text-white">{loco.name}</p>
                  <p className="text-xs text-mist-400">
                    {loco.electric ? t('Електрически') : t('Дизелов')} · {t('{0} от {1} вагона', wagonCount(tr.wagons), loco.maxWagons)} · {WAGON_TYPES.filter((k) => tr.wagons[k]).map((k) => `${WAGON_ICON[k]} ${tr.wagons[k]} ${tx(WAGONS[k].name)}`).join(' · ')}
                  </p>
                  <p className="text-xs text-mist-400">{t('Курсове: {0} · {1} т · спечелени {2}', tr.runs, int(tr.tons), money(tr.earnedCents))}</p>
                </div>
              </div>
              <TrainArt loco={tr.loco} wagons={list} show={4} className="h-14 w-full max-w-xl" />
              {run ? (
                <div className="space-y-1" data-testid="train-run">
                  <p className="text-sm text-mist-200">🚆 {place(run.from)} → {place(run.to)}{run.orderId ? ` · ${int(run.tons)} т ${tx(run.goods ?? '')}` : ` · ${t('без товар')}`}</p>
                  <div className="h-2 overflow-hidden rounded-full bg-asphalt-800"><div className="h-full rounded-full bg-cyan-glow" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
                  <p className="text-xs text-mist-400">{t('Пристига {0}', dateTime(run.arriveAt))}{run.payCents > 0 && ` · ${t('ще получиш {0}', money(run.payCents))}`}</p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-mist-200">📍 {t('На гара {0}', place(tr.at))}</p>
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-white">{t('Поръчки на гарата')}</h3>
                    {tr.orders.length === 0 ? <p className="text-sm text-mist-400">{t('Сега няма поръчки оттук.')}</p> : (
                      <ul className="space-y-1.5">
                        {tr.orders.map((o) => (
                          <li key={o.id} className={`stat-tile flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 ${o.why ? 'opacity-60' : ''}`} data-testid="train-order">
                            <div className="min-w-0 text-sm">
                              <p className="font-semibold text-white">{WAGON_ICON[o.wagonType]} {int(o.tons)} т {tx(o.goods)} → {place(o.to)}</p>
                              <p className="text-xs text-mist-400">
                                {int(o.km)} км · {duration(o.hours * 60)} · {t('{0} × {1}', o.need, tx(WAGONS[o.wagonType].name))}{!o.electric && ` · ${t('без ток')}`}
                                {' · '}<span className="text-profit">{money(o.pay)}</span> − {money(o.cost)}
                              </p>
                              {o.why && <p className="text-xs text-loss">{o.why === 'order_taken' ? t('Друг влак вече взе тази поръчка.') : reasonText(o.why)}</p>}
                            </div>
                            <ActionButton action={{ type: 'sendTrain', trainId: tr.id, orderId: o.id }} disabled={!!o.why} className="game-action game-action-gold flex-row px-3 py-1.5 text-xs">{t('Пусни влака')}</ActionButton>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="text-[11px] text-mist-400">{t('Новите поръчки идват {0}.', dateTime(tr.orders[0]?.until ?? now))}</p>
                  </div>
                  <details className="text-sm">
                    <summary className="cursor-pointer text-mist-300">{t('Без товар до друга гара')}</summary>
                    <div className="mt-2">
                      <FormAction action={{ type: 'moveTrain', trainId: tr.id }} submit={t('Пусни празен')} fields={[
                        { name: 'lineId', label: t('Линия'), type: 'select', options: linesFrom(tr.at).filter(({ line }) => !(loco.electric && !line.electric)).map(({ line, to }) => ({ value: line.id, label: `${place(tr.at)} → ${place(to)} (${int(line.km)} км, ${duration(line.hours * 60)})` })) },
                      ]} />
                    </div>
                  </details>
                  <details className="text-sm">
                    <summary className="cursor-pointer text-mist-300">{t('Вагони')}</summary>
                    <div className="mt-2 space-y-2">
                      {free > 0 && <FormAction action={{ type: 'addWagons', trainId: tr.id }} submit={t('Купи вагони')} fields={[
                        { name: 'wagonType', label: t('Вагон'), type: 'select', options: WAGON_TYPES.map((k) => ({ value: k, label: `${tx(WAGONS[k].name)} · ${WAGONS[k].tons} т · ${money(WAGONS[k].priceCents)}` })) },
                        { name: 'count', label: t('Брой'), type: 'number', defaultValue: 1, min: 1, max: free, step: 1 },
                      ]} />}
                      <FormAction action={{ type: 'sellWagons', trainId: tr.id }} submit={t('Продай вагони')} fields={[
                        { name: 'wagonType', label: t('Вагон'), type: 'select', options: WAGON_TYPES.filter((k) => tr.wagons[k]).map((k) => ({ value: k, label: `${tx(WAGONS[k].name)} (${tr.wagons[k]})` })) },
                        { name: 'count', label: t('Брой'), type: 'number', defaultValue: 1, min: 1, max: wagonCount(tr.wagons), step: 1 },
                      ]} />
                      <ActionButton action={{ type: 'sellTrain', trainId: tr.id }} confirm={t('Да продам целия влак за половината от цената?')} className="game-action flex-row px-3 py-1.5 text-xs">{t('Продай влака')}</ActionButton>
                    </div>
                  </details>
                </>
              )}
            </li>
          );
        })}
      </ul>

      <section className="panel space-y-3 p-4" data-testid="train-new">
        <h2 className="font-display text-lg font-bold text-white">🚆 {t('Нов влак')}</h2>
        <ul className="grid gap-2 sm:grid-cols-3">
          {LOCO_IDS.map((id) => (
            <li key={id} className="bus-model flex flex-col items-center gap-1 rounded-2xl p-2 text-center">
              <TrainArt loco={id} show={0} className="h-12 w-28" />
              <span className="text-xs font-semibold text-white">{LOCOS[id].name}</span>
              <span className="text-[11px] text-mist-400">{LOCOS[id].electric ? t('Електрически: само по електрифицирани линии, по-евтин за каране') : t('Дизелов: навсякъде, по-скъп за каране')}</span>
              <span className="text-[11px] text-mist-400">{t('до {0} вагона', LOCOS[id].maxWagons)} · {money(LOCOS[id].priceCents)}</span>
            </li>
          ))}
        </ul>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {WAGON_TYPES.map((k) => (
            <li key={k} className="bus-model rounded-2xl p-2 text-center text-xs">
              <TrainArt loco={null} wagons={[k]} show={1} className="mx-auto h-10 w-24" />
              <span className="block font-semibold text-white">{WAGON_ICON[k]} {tx(WAGONS[k].name)}</span>
              <span className="block text-[11px] text-mist-400">{WAGONS[k].tons} т · {money(WAGONS[k].priceCents)}</span>
              <span className="block text-[11px] text-mist-400">{WAGONS[k].goods.map((g) => tx(g)).join(', ')}</span>
            </li>
          ))}
        </ul>
        {locked ? <p className="text-sm text-mist-300">🔒 {t('Влаковете са от ниво {0}.', v.limits.minLevel)}</p>
          : v.trains.length >= v.limits.maxTrains ? <p className="text-sm text-mist-300">{t('Най-много {0} влака на играч.', v.limits.maxTrains)}</p>
          : (
            <FormAction action={{ type: 'buyTrain' }} submit={t('Купи влака')} fields={[
              { name: 'loco', label: t('Локомотив'), type: 'select', options: LOCO_IDS.map((id) => ({ value: id, label: `${LOCOS[id].name} · ${money(LOCOS[id].priceCents)}` })) },
              { name: 'wagonType', label: t('Вагони'), type: 'select', options: WAGON_TYPES.map((k) => ({ value: k, label: `${tx(WAGONS[k].name)} · ${money(WAGONS[k].priceCents)}` })) },
              { name: 'wagons', label: t('Брой вагони'), type: 'number', defaultValue: 10, min: TRAINS.minWagons, max: 32, step: 1 },
              { name: 'terminal', label: t('Товарна гара'), type: 'select', options: v.terminals.map((x) => ({ value: String(x.id), label: tx(x.name) })) },
            ]} />
          )}
        <p className="text-[11px] text-mist-400">{t('Марките са измислени. Цените, поръчките и разписанията са игрови данни.')}</p>
      </section>
    </div>
  );
}
