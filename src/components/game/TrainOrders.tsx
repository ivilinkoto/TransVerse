import { ActionButton } from '@/components/ui/ActionButton';
import { FormAction } from '@/components/ui/FormAction';
import { dateTime, duration, int, money } from '@/lib/format';
import { linesFrom, LOCOS, terminal, WAGONS, type WagonType } from '@/lib/game/trains';
import { reasonText, type TrainsView } from '@/server/game/trains';
import { t, tx } from '@/i18n/t';

export const WAGON_ICON: Record<WagonType, string> = { container: '📦', tank: '🛢️', covered: '🚃', hopper: '🌾' };
export const place = (id: number) => tx(terminal(id)?.name ?? '');

/** 1.3.3: the block-train orders at an idle train's terminal, and the empty run to another one (Курсове → Влакове). */
export function TrainOrders({ tr, now }: { tr: TrainsView['trains'][number]; now: Date }) {
  const loco = LOCOS[tr.loco];
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
    </>
  );
}
