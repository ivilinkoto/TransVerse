import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { FormAction } from '@/components/ui/FormAction';
import { SelectAction } from '@/components/ui/SelectAction';
import { BusArt } from '@/components/game/BusArt';
import { Bus3DButton } from '@/components/garage/Bus3DButton';
import { BUS_MODEL_IDS, BUS_MODELS, BUSES } from '@/lib/game/buses';
import { int, money } from '@/lib/format';
import { gameContext } from '@/server/game/context';
import { busesView } from '@/server/game/buses';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Автобусна компания') };
}

const prices = Array.from({ length: BUSES.price.max / 100 - BUSES.price.min / 100 + 1 }, (_, i) => BUSES.price.min / 100 + i);

/** 1.3 „Автобусна компания“: my bus lines with their tills, and a new line. */
export default async function BusesPage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.bus_lines) notFound();
  const v = await busesView(db, user.id, now);
  const tillTotal = v.lines.reduce((s, l) => s + l.till.cents, 0);
  return (
    <div className="space-y-4">
      <PageHeader title={t('Автобусна компания')} subtitle={t('Пътнически линии до големите градове — приходите се трупат в касата.')} help={t('Пътниците зависят от градовете, разстоянието, цената, комфорта и другите превозвачи на линията. Касата пази до {0} часа.', BUSES.tillHours)} />
      {v.lines.length > 0 && (
        <section className="bus-bar flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4" data-testid="bus-summary">
          <p className="font-display text-xl font-bold text-white">{t('В касите: {0}', money(tillTotal))}</p>
          <p className="text-xs text-mist-400">{t('{0} от {1} линии', v.lines.length, BUSES.maxLines)}</p>
        </section>
      )}
      <ul className="grid gap-3 lg:grid-cols-2" data-testid="bus-lines">
        {v.lines.map((l) => (
          <li key={l.id} className="bus-card space-y-3 rounded-3xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-display text-lg font-bold text-white">{tx(l.from.name)} ⇄ {tx(l.to.name)}</p>
                <p className="text-xs text-mist-400">{int(l.km)} км · {BUS_MODELS[l.model].name} · {t('{0} места', BUS_MODELS[l.model].seats)}{l.rivals > 0 && ` · ${t('конкуренти: {0}', l.rivals)}`}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <BusArt model={l.model} className="h-10 w-28" />
                <Bus3DButton model={l.model} title={`${BUS_MODELS[l.model].name} · ${tx(l.from.name)} ⇄ ${tx(l.to.name)}`} />
              </div>
            </div>
            <ul className="grid grid-cols-3 gap-2 text-sm">
              <li className="stat-tile rounded-xl px-2 py-1.5"><span className="block text-[10px] text-mist-400">{t('Пътници/ден')}</span><span className="font-bold text-white">{int(l.day.passengers)}</span></li>
              <li className="stat-tile rounded-xl px-2 py-1.5"><span className="block text-[10px] text-mist-400">{t('Печалба/ден')}</span><span className={`font-bold ${l.day.profitCents >= 0 ? 'text-profit' : 'text-loss'}`}>{money(l.day.profitCents)}</span></li>
              <li className="stat-tile rounded-xl px-2 py-1.5"><span className="block text-[10px] text-mist-400">{t('Пълнота')}</span><span className="font-bold text-white">{Math.round((l.day.perDeparture / BUS_MODELS[l.model].seats) * 100)}%</span></li>
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-mist-200">💰 {t('Касата: {0} ({1} ч)', money(l.till.cents), Math.floor(l.till.hours))}</p>
              <ActionButton action={{ type: 'collectBusLine', lineId: l.id }} disabled={l.till.cents === 0} className="game-action game-action-gold flex-row px-4 py-1.5 text-xs">{t('Прибери касата')}</ActionButton>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <SelectAction label={t('Запази')} ariaLabel={t('Курсове на ден')} value={String(l.departures)} field="departures" numeric action={{ type: 'setBusLine', lineId: l.id }} options={BUSES.departures.map((d) => ({ value: String(d), label: t('{0} на ден', d) }))} />
              <SelectAction label={t('Запази')} ariaLabel={t('Цена на билета')} value={String(l.priceCents / 100)} field="price" numeric action={{ type: 'setBusLine', lineId: l.id }} options={prices.map((p) => ({ value: String(p), label: t('{0} лв./100 км', p) }))} />
            </div>
            <div className="flex flex-wrap gap-2">
              {l.comfort < BUSES.comfort.maxLevel && <ActionButton action={{ type: 'upgradeBusComfort', lineId: l.id }} className="game-action flex-row px-3 py-1.5 text-xs">✨ {t('Комфорт {0} ({1})', l.comfort + 1, money(BUSES.comfort.costCents[l.comfort] ?? 0))}</ActionButton>}
              <ActionButton action={{ type: 'sellBusLine', lineId: l.id }} confirm={t('Да продам автобуса за {0}?', money(BUS_MODELS[l.model].priceCents * BUSES.sellBack))} className="game-action flex-row px-3 py-1.5 text-xs">{t('Продай')}</ActionButton>
            </div>
          </li>
        ))}
      </ul>
      <section className="panel space-y-3 p-4" data-testid="bus-new">
        <h2 className="font-display text-lg font-bold text-white">🚌 {t('Нова линия')}</h2>
        {user.level < BUSES.minLevel ? <p className="text-sm text-mist-300">🔒 {t('Автобусни линии — от ниво {0}.', BUSES.minLevel)}</p>
          : v.lines.length >= BUSES.maxLines ? <p className="text-sm text-mist-300">{t('Най-много {0} линии на играч.', BUSES.maxLines)}</p>
          : v.routes.length === 0 ? <p className="text-sm text-mist-300">{t('Линията тръгва от град, където имаш депо.')}</p>
          : (
            <>
              <ul className="grid grid-cols-3 gap-2">
                {BUS_MODEL_IDS.map((m) => (
                  <li key={m} className="bus-model flex flex-col items-center gap-1 rounded-2xl p-2 text-center">
                    <BusArt model={m} className="h-10 w-24" />
                    <span className="text-xs font-semibold text-white">{BUS_MODELS[m].name}</span>
                    <span className="text-[11px] text-mist-400">{t('{0} места', BUS_MODELS[m].seats)} · {money(BUS_MODELS[m].priceCents)}</span>
                    <Bus3DButton model={m} title={BUS_MODELS[m].name} />
                  </li>
                ))}
              </ul>
              <FormAction action={{ type: 'buyBusLine' }} submit={t('Купи автобус и открий линията')} fields={[
                { name: 'route', label: t('Линия'), type: 'select', options: v.routes.map((r) => ({ value: `${r.from.id}:${r.to.id}`, label: `${tx(r.from.name)} → ${tx(r.to.name)} (~${r.approxKm} км)` })) },
                { name: 'model', label: t('Автобус'), type: 'select', options: BUS_MODEL_IDS.map((m) => ({ value: m, label: `${BUS_MODELS[m].name} · ${money(BUS_MODELS[m].priceCents)}` })) },
                { name: 'departures', label: t('Курсове на ден'), type: 'select', options: BUSES.departures.map((d) => ({ value: String(d), label: String(d) })) },
                { name: 'price', label: t('Билет (лв. на 100 км)'), type: 'number', defaultValue: BUSES.price.ref / 100, min: BUSES.price.min / 100, max: BUSES.price.max / 100, step: 1 },
              ]} />
            </>
          )}
      </section>
    </div>
  );
}
