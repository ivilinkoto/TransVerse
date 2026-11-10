import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { eq } from 'drizzle-orm';
import { PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { FormAction } from '@/components/ui/FormAction';
import { SelectAction } from '@/components/ui/SelectAction';
import { ownerShare, rating, WORKSHOP } from '@/lib/game/workshops';
import { int, money } from '@/lib/format';
import { cities, depots } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';
import { workshopsView } from '@/server/game/workshops';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Сервизи') };
}

const stars = (n: number | null) => (n === null ? '—' : `${'★'.repeat(Math.round(n))}${'☆'.repeat(5 - Math.round(n))} ${n}`);

/** 1.3 „Собствен сервиз“: my workshop, repairs at other players' workshops, ratings and the busiest workshops. */
export default async function WorkshopsPage() {
  await initLocale();
  const { db, user, company, features } = await gameContext();
  if (!features.player_workshops) notFound();
  const v = await workshopsView(db, user.id);
  // Where a workshop can open: the cities of the player's trucks and depots.
  const truckCities = v.trucks.map((x) => ({ id: x.cityId, name: x.city }));
  const depotCities = await db.select({ id: cities.id, name: cities.nameBg }).from(depots).innerJoin(cities, eq(cities.id, depots.cityId)).where(eq(depots.companyId, company.id));
  const places = [...new Map([...depotCities, ...truckCities].map((c) => [c.id, c])).values()];
  const w = v.mine;
  const next = w ? WORKSHOP.levels[w.level - 1] : null;
  return (
    <div className="space-y-4">
      <PageHeader title={t('Сервизи на играчите')} subtitle={t('Отвори свой сервиз или ремонтирай при друг играч.')} help={t('Собственикът определя цената ({0}–{1}% от обичайната) и получава {2}% от платеното; с подобрения до {3}%.', WORKSHOP.price.min, WORKSHOP.price.max, ownerShare(1) * 100, ownerShare(3) * 100)} />

      <section className="workshop-card space-y-3 rounded-3xl p-4" data-testid="my-workshop">
        <h2 className="font-display text-lg font-bold text-white">🔧 {t('Моят сервиз')}</h2>
        {w ? (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <p className="font-display text-xl font-bold text-white">{tx(w.name)}</p>
              <p className="text-sm text-mist-300">{tx(w.city)} · {t('ниво {0}', w.level)} · {stars(rating(w))}</p>
            </div>
            <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <li className="stat-tile rounded-xl px-3 py-2"><span className="block text-[11px] text-mist-400">{t('Ремонти')}</span><span className="font-bold text-white">{int(w.repairs)}</span></li>
              <li className="stat-tile rounded-xl px-3 py-2"><span className="block text-[11px] text-mist-400">{t('Спечелено')}</span><span className="font-bold text-profit">{money(w.earnedCents)}</span></li>
              <li className="stat-tile rounded-xl px-3 py-2"><span className="block text-[11px] text-mist-400">{t('Твой дял')}</span><span className="font-bold text-white">{Math.round(ownerShare(w.level) * 100)}%</span></li>
              <li className="stat-tile rounded-xl px-3 py-2"><span className="block text-[11px] text-mist-400">{t('Цена')}</span><span className="font-bold text-white">{w.pricePct}%</span></li>
            </ul>
            <div className="flex flex-wrap items-end gap-3">
              <SelectAction label={t('Запази цената')} ariaLabel={t('Цена')} value={String(w.pricePct)} field="pricePct" numeric action={{ type: 'setWorkshopPrice' }} options={Array.from({ length: (WORKSHOP.price.max - WORKSHOP.price.min) / 5 + 1 }, (_, i) => WORKSHOP.price.min + i * 5).map((p) => ({ value: String(p), label: `${p}%` }))} />
              {next && w.level < WORKSHOP.levels.length && (
                <ActionButton action={{ type: 'upgradeWorkshop' }} className="game-action game-action-gold flex-row px-4 py-2 text-xs">⬆ {t('Ниво {0} ({1}) — дял {2}%', w.level + 1, money(next.upgradeCents), Math.round(ownerShare(w.level + 1) * 100))}</ActionButton>
              )}
            </div>
          </>
        ) : user.level < WORKSHOP.minLevel ? (
          <p className="text-sm text-mist-300">🔒 {t('Сервиз се отваря от ниво {0}.', WORKSHOP.minLevel)}</p>
        ) : places.length === 0 ? (
          <p className="text-sm text-mist-300">{t('Сервиз се отваря в град, където имаш депо или камион.')}</p>
        ) : (
          <>
            <p className="text-sm text-mist-300">{t('Отвори сервиз за {0} в град, където имаш депо или камион.', money(WORKSHOP.openCents))}</p>
            <FormAction action={{ type: 'openWorkshop' }} submit={t('Отвори сервиз')} fields={[
              { name: 'cityId', label: t('Град'), type: 'select', options: places.map((c) => ({ value: String(c.id), label: tx(c.name) })) },
              { name: 'name', label: t('Име на сервиза'), type: 'text', defaultValue: t('Сервиз {0}', user.username) },
            ]} />
          </>
        )}
      </section>

      <section className="panel space-y-3 p-4" data-testid="workshop-repairs">
        <h2 className="font-display text-lg font-bold text-white">🛠️ {t('Ремонт при играч')}</h2>
        {v.trucks.length === 0 ? <p className="text-sm text-mist-400">{t('Няма камион, който стои и има нужда от ремонт.')}</p> : (
          <ul className="space-y-2">
            {v.trucks.map((truck) => (
              <li key={truck.id} className="rounded-2xl bg-white/5 p-3">
                <p className="text-sm font-semibold text-white">{truck.plate} · {tx(truck.city)} · {Math.round(truck.condition)}%</p>
                {truck.workshops.length === 0 ? <p className="text-xs text-mist-400">{t('В този град няма сервиз на играч.')}</p> : (
                  <ul className="mt-2 space-y-1">
                    {truck.workshops.map((s) => (
                      <li key={s.ownerId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="min-w-0">{tx(s.name)} <span className="text-mist-400">· {tx(s.owner)} · {stars(s.stars)}</span></span>
                        <ActionButton action={{ type: 'repairAtWorkshop', vehicleId: truck.id, ownerId: s.ownerId }} className="game-action game-action-main flex-row px-3 py-1.5 text-xs">{t('Ремонт ({0}% от цената)', s.pricePct)}</ActionButton>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {v.toRate.length > 0 && (
        <section className="panel space-y-2 p-4" data-testid="workshop-rate">
          <h2 className="font-display font-bold text-white">⭐ {t('Оцени ремонта')}</h2>
          {v.toRate.map((s) => (
            <div key={s.ownerId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{tx(s.name)} · {tx(s.city)}</span>
              <span className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => <ActionButton key={n} action={{ type: 'rateWorkshop', ownerId: s.ownerId, stars: n }} className="game-action flex-row px-2 py-1 text-xs">{n}★</ActionButton>)}</span>
            </div>
          ))}
        </section>
      )}

      <section className="panel p-4">
        <h2 className="mb-2 font-display font-bold text-white">🏆 {t('Най-заетите сервизи')}</h2>
        {v.top.length === 0 ? <p className="text-sm text-mist-400">{t('Още няма сервизи на играчи — бъди първият.')}</p> : (
          <ol className="space-y-1 text-sm">
            {v.top.map((s, i) => (
              <li key={s.ownerId} className="flex justify-between gap-2"><span className="min-w-0 truncate">{int(i + 1)}. {tx(s.name)} <span className="text-mist-400">· {tx(s.city)} · {tx(s.owner)}</span></span><span className="shrink-0 text-mist-300">{t('{0} ремонта', s.repairs)} · {stars(s.stars)}</span></li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
