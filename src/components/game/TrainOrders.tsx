import Link from 'next/link';
import { ActionButton } from '@/components/ui/ActionButton';
import { FormAction } from '@/components/ui/FormAction';
import { dateTime, duration, int, money } from '@/lib/format';
import { runProgress, terminal, WAGONS, type WagonType } from '@/lib/game/trains';
import { LICENCES } from '@/lib/game/licences';
import { reasonText, type TrainsView } from '@/server/game/trains';
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
