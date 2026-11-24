import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { FormAction } from '@/components/ui/FormAction';
import { TrainArt } from '@/components/vehicles/trains';
import { place, RunStatus, TrainOrders, WAGON_ICON } from '@/components/game/TrainOrders';
import { ThingWindow } from '@/components/gameui/ThingWindow';
import { dateTime, int, money } from '@/lib/format';
import { LOCO_IDS, LOCOS, tareTons, TRAINS, WAGON_TYPES, WAGONS, wagonCount } from '@/lib/game/trains';
import { LICENCES } from '@/lib/game/licences';
import { gameContext } from '@/server/game/context';
import { trainsView } from '@/server/game/trains';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Влакове') };
}


/** 1.3.3 „Жп линия“ (Автопарк → Влакове): my trains — each with a window holding its orders, regular line, wagons, hire and sale — and a new train. */
export default async function TrainsPage({ searchParams }: { searchParams: Promise<{ train?: string }> }) {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.trains) notFound();
  const v = await trainsView(db, user.id, now);
  const params = await searchParams;
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
          const free = loco.maxWagons - wagonCount(tr.wagons);
          const fit = tr.orders.filter((o) => !o.why).length;
          const line = tr.line?.on ? tr.line : null;
          const lineText = line ? t('🔁 Редовна линия: {0} ⇄ {1}{2}', place(line.home), line.far ? place(line.far) : t('всяка гара'), line.wagonType ? ` · ${WAGON_ICON[line.wagonType]} ${tx(WAGONS[line.wagonType].name)}` : '') : null;
          const terminals = v.terminals.map((x) => ({ value: String(x.id), label: tx(x.name) }));
          // 1.3.3: everything for the train in one window — its orders, the regular line, the wagons, the hire and the sale.
          const sections = [
            {
              id: 'overview', label: t('Преглед'), emoji: '🚆',
              content: (
                <div className="space-y-3 text-sm">
                  <TrainArt loco={tr.loco} wagons={list} show={6} className="h-20 w-full" />
                  <p className="text-xs text-mist-400">{loco.electric ? t('Електрически') : t('Дизелов')} · {t('{0} kW', int(loco.powerKw))} · {t('{0} от {1} вагона', wagonCount(tr.wagons), loco.maxWagons)} · {t('{0} т празен, до {1} т на равно', int(tareTons(tr.wagons)), int(loco.maxTons))}</p>
                  <p className="text-xs text-mist-400">{WAGON_TYPES.filter((k) => tr.wagons[k]).map((k) => `${WAGON_ICON[k]} ${tr.wagons[k]} ${tx(WAGONS[k].name)}`).join(' · ')}</p>
                  {run ? <RunStatus run={run} now={now} /> : <p className="text-mist-200">📍 {t('На гара {0}', place(tr.at))}{' · '}{t('Поръчки за този влак: {0}', fit)}</p>}
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="stat-tile rounded-xl p-2"><b className="block text-base text-white">{tr.runs}</b>{t('курса')}</div>
                    <div className="stat-tile rounded-xl p-2"><b className="block text-base text-white">{int(tr.tons)}</b>{t('тона')}</div>
                    <div className="stat-tile rounded-xl p-2"><b className="block text-base text-profit">{money(tr.earnedCents)}</b>{t('спечелени')}</div>
                  </div>
                  <p className="text-xs text-mist-300">{lineText ?? t('Без редовна линия — пускаш го на ръка или от известието „Пусни пак“.')}{tr.hireShare ? ` · ${t('под наем за {0}%', Math.round(tr.hireShare * 100))}` : ''}</p>
                </div>
              ),
            },
            { id: 'orders', label: t('Поръчки'), emoji: '📋', content: run ? <RunStatus run={run} now={now} /> : <TrainOrders tr={tr} now={now} /> },
            {
              id: 'line', label: t('Редовна линия'), emoji: '🔁',
              content: (
                <div className="space-y-3 text-sm" data-testid="train-line">
                  <p className="text-mist-300">{t('Влакът сам взима най-изгодната подходяща поръчка, щом е свободен на гарата: до другия край на линията (или до всяка гара), с вагоните, които избереш. Ако дълго няма товар, може да се върне празен.')}</p>
                  {lineText && <p className="font-semibold text-white">{lineText}</p>}
                  <FormAction action={{ type: 'setTrainLine', trainId: tr.id, on: true }} submit={line ? t('Промени линията') : t('Пусни линията')} fields={[
                    { name: 'home', label: t('Начална гара'), type: 'select', defaultValue: String(line?.home ?? tr.at), options: terminals },
                    { name: 'far', label: t('Другият край'), type: 'select', defaultValue: String(line?.far ?? 0), options: [{ value: '0', label: t('Всяка гара') }, ...terminals] },
                    { name: 'wagonType', label: t('Товар'), type: 'select', defaultValue: line?.wagonType ?? 'any', options: [{ value: 'any', label: t('Всякакъв, който може') }, ...WAGON_TYPES.filter((k) => tr.wagons[k]).map((k) => ({ value: k, label: `${WAGON_ICON[k]} ${tx(WAGONS[k].name)}` }))] },
                    { name: 'emptyBack', label: t('Без товар {0} часа — празен до другия край', TRAINS.windowHours), type: 'checkbox', defaultValue: line?.emptyBack ?? true },
                  ]} />
                  {line && <ActionButton action={{ type: 'setTrainLine', trainId: tr.id, on: false }} className="btn-ghost px-3 py-1.5 text-xs">{t('Спри линията')}</ActionButton>}
                </div>
              ),
            },
            {
              id: 'wagons', label: t('Вагони'), emoji: '🚃',
              content: run ? <p className="text-sm text-mist-300">{t('Влакът е на път. Вагоните се закачат на гарата.')}</p> : (
                <div className="space-y-2 text-sm">
                  {free > 0 && <FormAction action={{ type: 'addWagons', trainId: tr.id }} submit={t('Купи вагони')} fields={[
                    { name: 'wagonType', label: t('Вагон'), type: 'select', options: WAGON_TYPES.map((k) => ({ value: k, label: `${tx(WAGONS[k].name)} · ${WAGONS[k].tons} т · ${money(WAGONS[k].priceCents)}` })) },
                    { name: 'count', label: t('Брой'), type: 'number', defaultValue: 1, min: 1, max: free, step: 1 },
                  ]} />}
                  <FormAction action={{ type: 'sellWagons', trainId: tr.id }} submit={t('Продай вагони')} fields={[
                    { name: 'wagonType', label: t('Вагон'), type: 'select', options: WAGON_TYPES.filter((k) => tr.wagons[k]).map((k) => ({ value: k, label: `${tx(WAGONS[k].name)} (${tr.wagons[k]})` })) },
                    { name: 'count', label: t('Брой'), type: 'number', defaultValue: 1, min: 1, max: wagonCount(tr.wagons), step: 1 },
                  ]} />
                </div>
              ),
            },
            {
              id: 'hire', label: t('Под наем'), emoji: '🤝',
              content: (
                <div className="text-sm" data-testid="train-for-hire">
                  <FormAction action={{ type: 'setTrainHire', trainId: tr.id }} submit={t('Запази')} fields={[
                    { name: 'share', label: tr.hireShare ? t('Под наем за {0}% от поръчката — другите играчи могат да карат поръчки с него', Math.round(tr.hireShare * 100)) : t('Пусни влака под наем: другите играчи карат поръчки с него, а ти получаваш таксата'), type: 'select', defaultValue: String(tr.hireShare ?? 0), options: [{ value: '0', label: t('Не е под наем') }, ...TRAINS.hire.shares.map((x) => ({ value: String(x), label: t('{0}% от поръчката', Math.round(x * 100)) }))] },
                  ]} />
                </div>
              ),
            },
            {
              id: 'sell', label: t('Продажба'), emoji: '🏷️',
              content: run ? <p className="text-sm text-mist-300">{t('Влакът е на път. Продава се, когато е на гара.')}</p> : <ActionButton action={{ type: 'sellTrain', trainId: tr.id }} confirm={t('Да продам целия влак за половината от цената?')} className="btn-danger px-3 py-1.5 text-sm">{t('Продай влака')}</ActionButton>,
            },
          ];
          return (
            <li key={tr.id} className="bus-card space-y-3 rounded-3xl p-4" data-testid="train">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-lg font-bold text-white">{loco.name}</p>
                  <p className="text-xs text-mist-400">{run ? t('🛤️ На път към {0}', place(run.to)) : t('📍 На гара {0} · поръчки: {1}', place(tr.at), fit)}{lineText ? ` · ${lineText}` : ''}</p>
                </div>
              </div>
              <TrainArt loco={tr.loco} wagons={list} show={4} className="h-14 w-full max-w-xl" />
              {run && <RunStatus run={run} now={now} />}
              <ThingWindow
                button={<><span aria-hidden>🚆</span>{t('Всичко за този влак')}</>}
                title={loco.name}
                icon="🚆"
                sections={sections}
                initialOpen={params.train === tr.id}
                initialTab={params.train === tr.id ? (run ? 'overview' : 'orders') : undefined}
                testId="train-window"
              />
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
              <span className="text-[11px] text-mist-400">{t('{0} kW · до {1} т на равно · до {2} вагона', int(LOCOS[id].powerKw), int(LOCOS[id].maxTons), LOCOS[id].maxWagons)} · {money(LOCOS[id].priceCents)}</span>
            </li>
          ))}
        </ul>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {WAGON_TYPES.map((k) => (
            <li key={k} className="bus-model rounded-2xl p-2 text-center text-xs">
              <TrainArt loco={null} wagons={[k]} show={1} className="mx-auto h-10 w-24" />
              <span className="block font-semibold text-white">{WAGON_ICON[k]} {tx(WAGONS[k].name)}</span>
              <span className="block text-[11px] text-mist-400">{t('{0} т товар, {1} т празен', WAGONS[k].tons, WAGONS[k].tare)} · {money(WAGONS[k].priceCents)}</span>
              <span className="block text-[11px] text-mist-400">{WAGONS[k].goods.map((g) => tx(g)).join(', ')}</span>
            </li>
          ))}
        </ul>
        {!v.limits.vip ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gold-400/30 bg-gold-400/5 px-3 py-2 text-sm" data-testid="train-vip">
            <span>👑 {t('Собствен влак е от VIP{0}. Дотогава наемай влак за поръчката в Курсове → Влакове.', TRAINS.vipLevel)}</span>
            <span className="flex gap-2"><Link href="/game/contracts/trains" className="btn-ghost px-3 py-1.5 text-xs">{t('Наеми влак')}</Link><Link href="/game/shop" className="btn-gold px-3 py-1.5 text-xs">{t('Към магазина')}</Link></span>
          </div>
        ) : locked ? <p className="text-sm text-mist-300">🔒 {t('Влаковете са от ниво {0}.', v.limits.minLevel)}</p>
          : !v.licensed ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gold-400/30 bg-gold-400/5 px-3 py-2 text-sm" data-testid="train-licence">
              <span>📜 {t('За собствен влак е нужен ЖП лиценз ({0}). За курс през граница — и международен, а извън ЕС и митнически лиценз.', money(LICENCES.rail.priceCents))}</span>
              <Link href="/game/licences" className="btn-gold px-3 py-1.5 text-xs">{t('Към лицензите')}</Link>
            </div>
          )
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
