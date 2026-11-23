import Link from 'next/link';
import { ActionButton } from '@/components/ui/ActionButton';
import { FormAction } from '@/components/ui/FormAction';
import { dateTime, duration, int, money } from '@/lib/format';
import { LOCOS, runProgress, terminal, TRAINS, WAGONS, type WagonType } from '@/lib/game/trains';
import { LICENCES } from '@/lib/game/licences';
import { reasonText, type hireBoard, type TrainsView } from '@/server/game/trains';
import { t, tx } from '@/i18n/t';

export const WAGON_ICON: Record<WagonType, string> = { container: '📦', tank: '🛢️', covered: '🚃', hopper: '🌾' };
export const place = (id: number) => tx(terminal(id)?.name ?? '');
/** „София → Горна Оряховица → Варна“ */
export const route = (stops: number[]) => stops.map(place).join(' → ');

/** 1.3.3: the block-train orders at an idle train's terminal, and the empty run to another one (Курсове → Влакове). */
export function TrainOrders({ tr, now }: { tr: TrainsView['trains'][number]; now: Date }) {
  return (
    <>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-white">{t('Поръчки на гарата')}</h3>
        {tr.orders.length === 0 ? <p className="text-sm text-mist-400">{t('Сега няма поръчки оттук.')}</p> : (
          <ul className="space-y-1.5">
            {tr.orders.map((o) => (
              <li key={o.id} className={`stat-tile flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 ${o.why ? 'opacity-60' : ''}`} data-testid="train-order">
                <div className="min-w-0 text-sm">
                  <p className="font-semibold text-white">{WAGON_ICON[o.wagonType]} {int(o.tons)} т {tx(o.goods)} → {place(o.to)}</p>
                  {o.stops.length > 2 && <p className="text-xs text-mist-300">🛤️ {route(o.stops)}</p>}
                  <p className="text-xs text-mist-400">
                    {int(o.km)} км · {duration(o.hours * 60)} · {t('{0} × {1}', o.need, tx(WAGONS[o.wagonType].name))}
                    {' · '}{t('{0} от {1} т', int(o.gross), int(o.limit))}
                    {!o.electric && ` · ${t('без ток')}`}
                    {o.borders.length > 0 && ` · 🛂 ${o.borders.map((b) => tx(b.name)).join(', ')}`}
                  </p>
                  <p className="text-xs text-mist-400"><span className="text-profit">{money(o.pay)}</span> − {money(o.cost)} {t('такса и енергия')}</p>
                  {o.why && <p className="text-xs text-loss">{o.why === 'order_taken' ? t('Друг влак вече взе тази поръчка.') : o.why === 'licence' ? <>{t('Нужен е лиценз: {0}.', o.missing.map((id) => tx(LICENCES[id].label)).join(', '))} <Link href="/game/licences" className="underline">{t('Към лицензите')}</Link></> : reasonText(o.why)}</p>}
                </div>
                <ActionButton action={{ type: 'sendTrain', trainId: tr.id, orderId: o.id }} disabled={!!o.why} className="game-action game-action-gold flex-row px-3 py-1.5 text-xs">{t('Пусни влака')}</ActionButton>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-mist-400">{t('Новите поръчки идват {0}.', dateTime(tr.orders[0]?.until ?? now))}</p>
      </div>
      {tr.empty.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-mist-300">{t('Без товар до друга гара')}</summary>
          <div className="mt-2">
            <FormAction action={{ type: 'moveTrain', trainId: tr.id }} submit={t('Пусни празен')} fields={[
              { name: 'to', label: t('Гара'), type: 'select', options: tr.empty.map((p) => ({ value: String(p.to), label: `${route(p.stops)} · ${int(p.km)} км · ${duration(p.hours * 60)} · ${money(p.cost.total)}` })) },
            ]} />
          </div>
        </details>
      )}
    </>
  );
}

/** 1.3.3: a train on its way — the route, where it is now (on a line, at a border, at a stop), the progress and the arrival. */
export function RunStatus({ run, now }: { run: NonNullable<TrainsView['trains'][number]['run']>; now: Date }) {
  const { leg, share } = runProgress(run, now.getTime());
  const where = !leg ? '' : leg.kind === 'border' ? t('🛂 На границата: {0}', tx(leg.note ?? '')) : leg.kind === 'stop' ? t('⏸️ Кратък престой на гара {0}', place(leg.from)) : t('🛤️ Между {0} и {1}', place(leg.from), place(leg.to));
  return (
    <div className="space-y-1" data-testid="train-run">
      <p className="text-sm text-mist-200">🚆 {route(run.stops)}{run.orderId ? ` · ${int(run.tons)} т ${tx(run.goods ?? '')}` : ` · ${t('без товар')}`}</p>
      <p className="text-xs text-mist-300">{where}</p>
      <div className="h-2 overflow-hidden rounded-full bg-asphalt-800"><div className="h-full rounded-full bg-cyan-glow" style={{ width: `${Math.round(share * 100)}%` }} /></div>
      <p className="text-xs text-mist-400">{t('Пристига {0}', dateTime(run.arriveAt))} · {t('{0} т с вагоните', int(run.grossTons))}{run.payCents > 0 && ` · ${t('ще получиш {0}', money(run.payCents))}`}</p>
    </div>
  );
}

/** 1.3.3: hire a train for one order — the game's or a player's put out for hire at this terminal (Курсове → Влакове). */
export function HireBoard({ v, now }: { v: Awaited<ReturnType<typeof hireBoard>>; now: Date }) {
  const locked = v.level < v.minLevel;
  return (
    <section className="panel space-y-3 p-4" data-testid="train-hire">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-bold text-white">🤝 {t('Наеми влак')}</h2>
        <p className="text-xs text-mist-400">{t('Наети влакове на път: {0} от {1}', v.active.length, v.hires)}</p>
      </div>
      <p className="text-sm text-mist-300">{t('Без собствен влак: вземи поръчка и я карай с наем — влак на играта (за {0}% от поръчката) или влак на друг играч, който го е пуснал под наем (за неговата такса). Плащаш таксата за линията и енергията; поръчката е твоя.', Math.round(TRAINS.hire.gameShare * 100))}</p>
      {locked ? <p className="text-sm text-mist-300">🔒 {t('Наем на влак е от ниво {0}.', v.minLevel)}</p> : (
        <>
          <nav className="flex flex-wrap gap-1.5" aria-label={t('Гара')}>
            {v.terminals.map((x) => {
              const n = v.forHireAt.get(x.id) ?? 0;
              return (
                <Link key={x.id} href={`/game/contracts/trains?at=${x.id}`} scroll={false} className={`shop-tab px-2.5 py-1 text-xs ${v.terminal?.id === x.id ? 'shop-tab-on' : ''}`} aria-current={v.terminal?.id === x.id ? 'page' : undefined}>
                  {tx(x.name)}{n > 0 && ` · 🚆${n}`}
                </Link>
              );
            })}
          </nav>
          {v.orders.length === 0 ? <p className="text-sm text-mist-400">{t('Сега няма поръчки оттук.')}</p> : (
            <ul className="space-y-1.5">
              {v.orders.map((o) => (
                <li key={o.id} className={`stat-tile space-y-1.5 rounded-xl px-3 py-2 ${o.taken ? 'opacity-60' : ''}`} data-testid="hire-order">
                  <p className="text-sm font-semibold text-white">{WAGON_ICON[o.wagonType]} {int(o.tons)} т {tx(o.goods)} → {place(o.to)} <span className="text-profit">{money(o.pay)}</span></p>
                  <p className="text-xs text-mist-400">{o.stops.length > 2 ? `🛤️ ${route(o.stops)} · ` : ''}{int(o.km)} км{o.borders.length > 0 && ` · 🛂 ${o.borders.map((b) => tx(b.name)).join(', ')}`}</p>
                  {o.taken ? <p className="text-xs text-loss">{t('Друг влак вече взе тази поръчка.')}</p> : (
                    <ul className="space-y-1">
                      {o.players.map((p) => (
                        <li key={p.trainId} className="flex flex-wrap items-center justify-between gap-2 text-xs" data-testid="hire-player">
                          <span className="text-mist-200">🚆 {t('{0} на {1}', LOCOS[p.loco].name, p.owner)} · {t('такса {0}% ({1})', Math.round(p.share * 100), money(p.fee))} · {t('линия и енергия {0}', money(p.cost))} · {duration(p.hours * 60)} · <span className={p.net > 0 ? 'text-profit' : 'text-loss'}>{t('остават {0}', money(p.net))}</span></span>
                          <ActionButton action={{ type: 'hireTrain', terminal: o.from, orderId: o.id, via: p.trainId }} disabled={v.active.length >= v.hires} className="game-action game-action-gold flex-row px-3 py-1 text-xs">{t('Наеми')}</ActionButton>
                        </li>
                      ))}
                      {o.game ? (
                        <li className="flex flex-wrap items-center justify-between gap-2 text-xs" data-testid="hire-game">
                          <span className="text-mist-200">🏢 {t('Влак на играта ({0})', LOCOS[o.game.loco].name)} · {t('такса {0}% ({1})', Math.round(TRAINS.hire.gameShare * 100), money(o.game.fee))} · {t('линия и енергия {0}', money(o.game.cost))} · {duration(o.game.hours * 60)} · <span className={o.game.net > 0 ? 'text-profit' : 'text-loss'}>{t('остават {0}', money(o.game.net))}</span></span>
                          <ActionButton action={{ type: 'hireTrain', terminal: o.from, orderId: o.id, via: 'game' }} disabled={v.active.length >= v.hires} className="game-action flex-row px-3 py-1 text-xs">{t('Наеми')}</ActionButton>
                        </li>
                      ) : <li className="text-xs text-mist-400">{t('Няма влак на играта за тази поръчка.')}</li>}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
          {v.active.length >= v.hires && <p className="text-xs text-mist-300">{t('Най-много {0} наети влака наведнъж. Повече — с по-високо VIP ниво.', v.hires)} <Link href="/game/shop" className="underline">{t('Към магазина')}</Link></p>}
        </>
      )}
      {v.active.length > 0 && (
        <ul className="space-y-1.5 text-sm" data-testid="hire-active">
          {v.active.map((h) => (
            <li key={h.id} className="stat-tile space-y-1 rounded-xl px-3 py-2">
              <p className="font-semibold text-white">{LOCOS[h.loco].name} · {h.rental ? t('влак на играта') : t('нает от играч')}</p>
              <RunStatus run={h.run} now={now} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
