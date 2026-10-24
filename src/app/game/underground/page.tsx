import { inArray } from 'drizzle-orm';
import { ArrowRight, Lock, Moon, ShieldCheck } from 'lucide-react';
import { notFound } from 'next/navigation';
import { Badge, Card, Empty, Meter, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { SelectAction } from '@/components/ui/SelectAction';
import { dateTime, km, money } from '@/lib/format';
import { borderCheckChance, contactLevel, heatLabel, runCatchChance, SMUGGLING, UNDERGROUND_TIERS } from '@/lib/game/smuggling';
import { cities, routes } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';
import { compatibilityError } from '@/server/game/deliveries';
import { fleetView } from '@/server/game/queries';
import { compartmentError, smugglingOffers, smugglingView } from '@/server/game/smuggling';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Сенки') };
}

export default async function UndergroundPage() {
  await initLocale();
  const { db, user, company, now, features } = await gameContext();
  if (!features.smuggling) notFound();
  const locked = user.level < SMUGGLING.minLevel;
  const view = await smugglingView(db, user.id);
  const { profile, tier } = view;
  const active = !locked && profile.optIn;
  const [offers, fleet] = active ? await Promise.all([smugglingOffers(db, user.id, now), fleetView(db, company.id)]) : [[], null];
  const cityRows = offers.length ? await db.select({ id: cities.id, nameBg: cities.nameBg, countryCode: cities.countryCode }).from(cities).where(inArray(cities.id, [...new Set(offers.flatMap((o) => [o.originCityId, o.destCityId]))])) : [];
  const routeRows = offers.length ? await db.select({ id: routes.id, borders: routes.borders }).from(routes).where(inArray(routes.id, [...new Set(offers.map((o) => o.routeId))])) : [];
  const city = (id: number) => cityRows.find((c) => c.id === id);
  const own = fleet?.vehicles.filter((v) => v.ownership === 'owned') ?? [];
  const heat = heatLabel(profile.heat);
  const next = UNDERGROUND_TIERS[tier.tier + 1];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('Сенки')}
        subtitle={t('Сенчести пратки по избор: по-добре платени, но митницата не спи. Две репутации — честната и подземната.')}
        help={t('Това е по избор и само с игрови пари (никога ТрансКоин). Стоките са безобидни — дрехи с измислени „маркови“ етикети, недекларирана електроника, сирене без документи. Офертите идват вечер ({0}:00–24:00), минават граница и плащат около ×{1}–3. На всяка граница митницата може да провери: шансът расте с „Вниманието“ и с полицейските сигнали по пътя, пада с тайно отделение и с доверен контакт в града. Хванат ли те, стоката се конфискува (без плащане) и има глоба — парите ти никога не падат под 0. С нает камион не става.', SMUGGLING.eveningFrom, SMUGGLING.multiplier.min)}
      />

      {locked ? (
        <Card>
          <Empty icon={Lock} title={t('От ниво {0}', SMUGGLING.minLevel)}>{t('Сенчестите пратки се отключват от ниво {0}. Ти си ниво {1}.', SMUGGLING.minLevel, user.level)}</Empty>
        </Card>
      ) : (
        <Card title={t('Твоят избор')} actions={<Badge tone={profile.optIn ? 'violet' : 'neutral'}>{profile.optIn ? t('включено') : t('изключено')}</Badge>}>
          <p className="mb-3 text-sm text-mist-300">{profile.optIn ? t('Виждаш вечерните оферти. Можеш да ги изключиш по всяко време — отворените оферти изчезват.') : t('Изключено е: не виждаш сенчести оферти и играта е само честна. Включваш го тук или в Настройки.')}</p>
          <ActionButton action={{ type: 'smugglingOptIn', on: !profile.optIn }} className={profile.optIn ? 'btn-ghost px-3 py-1.5 text-sm' : 'btn-primary px-3 py-1.5 text-sm'} confirm={profile.optIn ? undefined : t('Да включим ли сенчестите пратки? Рискът е твой — глоба и конфискация при проверка.')}>
            {profile.optIn ? t('Изключи сенчестите пратки') : t('🌙 Включи сенчестите пратки')}
          </ActionButton>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t('Внимание на митницата')}>
          <div className="flex items-center justify-between text-sm"><Badge tone={heat.tone}>{tx(heat.label)}</Badge><span className="num">{tx(profile.heat)} / {tx(SMUGGLING.heatMax)}</span></div>
          <Meter value={profile.heat} tone="gold" className="mt-1.5" />
          <p className="mt-2 text-xs text-mist-400">{t('Расте с всяка пратка (+{0}, при хващане +{1}). Пада с честните курсове (−{2}), само по себе си (−{3} на ден) и когато докладваш оферта (−{4}).', SMUGGLING.heatPerRun, SMUGGLING.heatCaught, SMUGGLING.heatHonestDrop, SMUGGLING.heatDailyDrop, SMUGGLING.heatReportDrop)}</p>
        </Card>
        <Card title={t('Подземна репутация')} actions={<Badge tone="violet">{tx(tier.name)}</Badge>}>
          <div className="flex items-center justify-between text-sm"><span>{t('{0} точки', profile.underground)}</span>{next && <span className="text-xs text-mist-400">{t('до „{0}“: {1}', next.name, next.min - profile.underground)}</span>}</div>
          {next && <Meter value={((profile.underground - tier.min) / (next.min - tier.min)) * 100} tone="violet" className="mt-1.5" />}
          <p className="mt-2 text-xs text-mist-300">{tx(tier.perk)}</p>
          <p className="mt-1 text-xs text-mist-400">{t('Пратки: {0} · хванати: {1} · докладвани: {2}. Честната репутация на компанията е отделна — {3}.', profile.runs, profile.caught, profile.reports, Math.floor(company.reputation))}</p>
        </Card>
      </div>

      {active && (
        <Card title={<span className="inline-flex items-center gap-2"><Moon className="h-4 w-4 text-violet-300" />{t('Вечерни оферти')}</span>}>
          {offers.length === 0 ? (
            <Empty icon={Moon} title={t('Няма оферти сега')}>{t('Офертите идват вечер ({0}:00–24:00) за градовете, където имаш свой камион.', SMUGGLING.eveningFrom)}</Empty>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {offers.map((o) => {
                const borders = routeRows.find((r) => r.id === o.routeId)?.borders.length ?? 0;
                const contact = view.contacts.find((c) => c.cityId === o.originCityId);
                const risk = (compartment: boolean) => Math.round(runCatchChance(borders, borderCheckChance({ heat: profile.heat, policeReports: 0, compartment, contactLevel: contact?.level ?? 0 })) * 100);
                const options = own.map((v) => {
                  const error = compatibilityError({ modelId: v.modelId, trailerModelId: v.trailer?.modelId ?? null, condition: v.condition, hasDriver: !!v.driver, status: v.status, trailerCondition: v.trailer?.condition ?? null }, { cargoType: o.cargoType, weightTons: o.weightTons, minLevel: o.minLevel }, user.level) ?? compartmentError(v, v.trailer?.modelId ?? null, o.weightTons);
                  return { value: v.id, label: `${v.plate} · ${v.city.nameBg}${v.hiddenCompartment ? ' · 🕳️' : ''}${error ? t(' (не става)') : ''}`, disabled: !!error };
                });
                return (
                  <li key={o.id} className="flex flex-col rounded-2xl border border-violet-500/30 bg-asphalt-850 p-4">
                    <div className="font-semibold">{tx(o.goods)}</div>
                    <div className="text-xs text-mist-400">{t('{0} · {1} т', o.shipper, o.weightTons)}</div>
                    <div className="mt-2 inline-flex flex-wrap items-center gap-1.5 text-sm">
                      <span className="font-semibold">{tx(city(o.originCityId)?.nameBg)}</span><ArrowRight className="h-3.5 w-3.5 text-mist-400" /><span className="font-semibold">{tx(city(o.destCityId)?.nameBg)}</span><span className="text-mist-400">· {km(o.distanceKm)}</span>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                      <div><dt className="label">{t('Плащане')}</dt><dd className="num text-profit">{money(o.rewardCents)}</dd></div>
                      <div><dt className="label">{t('Граници')}</dt><dd className="num">{borders}</dd></div>
                      <div><dt className="label">{t('Риск')}</dt><dd className="num">~{risk(false)} %<span className="text-xs text-mist-400">{' '}{t('(с отделение ~{0} %)', risk(true))}</span></dd></div>
                      <div><dt className="label">{t('Глоба при проверка')}</dt><dd className="num text-loss">{t('до {0}', money(Math.round(o.rewardCents * SMUGGLING.fineShare)))}</dd></div>
                    </dl>
                    {contact && <div className="mt-2 text-xs text-violet-300">{t('Контакт в {0}: ниво {1} (по-добро плащане, по-малък риск)', contact.city, contact.level)}</div>}
                    <p className="mt-1 text-[11px] text-mist-500">{t('Полицейските сигнали по пътя вдигат риска. Офертата важи до {0}.', dateTime(o.expiresAt))}</p>
                    <div className="mt-auto space-y-2 pt-3">
                      {own.length ? <SelectAction label={t('Тръгни')} ariaLabel={t('Камион за {0}', o.goods)} value="" options={[{ value: '', label: t('— свой камион —') }, ...options]} action={{ type: 'acceptContract', contractId: o.id }} field="vehicleId" /> : <p className="text-xs text-mist-400">{t('Нужен е свой камион — с нает не става.')}</p>}
                      <ActionButton action={{ type: 'reportShady', contractId: o.id }} className="btn-ghost px-3 py-1.5 text-xs"><ShieldCheck className="h-3.5 w-3.5" />{t('Докладвай на митницата (+{0} репутация)', SMUGGLING.reportReputation)}</ActionButton>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {active && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title={t('Черен пазар')}>
            {own.length === 0 ? <p className="text-sm text-mist-400">{t('Нямаш свой камион.')}</p> : (
              <ul className="space-y-3 text-sm">
                {own.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span><span className="font-medium">{tx(v.plate)}</span> <span className="text-mist-400">· {tx(v.model.name)} · {Math.round(v.condition)} %</span></span>
                    <span className="flex flex-wrap gap-2">
                      {v.hiddenCompartment ? <Badge tone="violet">{t('🕳️ тайно отделение')}</Badge> : <ActionButton action={{ type: 'buyCompartment', vehicleId: v.id }} disabled={tier.tier < 1 || v.status !== 'idle'} confirm={t('Тайно отделение за {0}? Взима {1} т от товароносимостта.', money(SMUGGLING.compartmentPriceCents), SMUGGLING.compartmentPayloadTons)} className="btn-ghost px-2.5 py-1 text-xs">{t('Тайно отделение · {0}', money(SMUGGLING.compartmentPriceCents))}</ActionButton>}
                      <ActionButton action={{ type: 'blackRepair', vehicleId: v.id }} disabled={tier.tier < 2 || v.status !== 'idle' || v.condition >= 100} className="btn-ghost px-2.5 py-1 text-xs">{t('Ремонт „на тъмно“ −{0} %', Math.round((1 - SMUGGLING.blackRepairShare) * 100))}</ActionButton>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-mist-400">{t('Тайното отделение (от „{0}“) намалява шанса за находка наполовина, но взима {1} т. Евтиният ремонт (от „{2}“) се забелязва: +{3} внимание.', UNDERGROUND_TIERS[1].name, SMUGGLING.compartmentPayloadTons, UNDERGROUND_TIERS[2].name, SMUGGLING.blackRepairHeat)}</p>
          </Card>
          <Card title={t('Контакти')}>
            {view.contacts.length === 0 ? <p className="text-sm text-mist-400">{t('Всяка успешна пратка от един град ти дава познат там. На всеки {0} пратки контактът расте.', SMUGGLING.contactRunsPerLevel)}</p> : (
              <ul className="space-y-1 text-sm">
                {view.contacts.map((c) => <li key={c.cityId} className="flex justify-between"><span>{tx(c.city)}</span><span className="text-xs text-mist-400">{t('ниво {0} · {1} пратки', contactLevel(c.runs), c.runs)}</span></li>)}
              </ul>
            )}
          </Card>
        </div>
      )}

      {view.last.length > 0 && (
        <Card title={t('Последни пратки')}>
          <ul className="divide-y divide-asphalt-800 text-sm">
            {view.last.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                <span className="text-mist-300">{dateTime(c.at)} · {tx(c.borders)} {c.borders === 1 ? t('граница') : t('граници')}</span>
                {c.caught ? <Badge tone="red">{t('хваната{0}', c.fineCents ? ` · ${money(c.fineCents)}` : '')}</Badge> : <Badge tone="green">{t('мина')}</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="text-xs text-mist-500">{t('Всичко тук е игра: измислени стоки, игрови пари и игрови данни.')}</p>
    </div>
  );
}
