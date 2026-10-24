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

export const metadata = { title: 'Сенки' };

export default async function UndergroundPage() {
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
        title="Сенки"
        subtitle="Сенчести пратки по избор: по-добре платени, но митницата не спи. Две репутации — честната и подземната."
        help={`Това е по избор и само с игрови пари (никога ТрансКоин). Стоките са безобидни — дрехи с измислени „маркови“ етикети, недекларирана електроника, сирене без документи. Офертите идват вечер (${SMUGGLING.eveningFrom}:00–24:00), минават граница и плащат около ×${SMUGGLING.multiplier.min}–3. На всяка граница митницата може да провери: шансът расте с „Вниманието“ и с полицейските сигнали по пътя, пада с тайно отделение и с доверен контакт в града. Хванат ли те, стоката се конфискува (без плащане) и има глоба — парите ти никога не падат под 0. С нает камион не става.`}
      />

      {locked ? (
        <Card>
          <Empty icon={Lock} title={`От ниво ${SMUGGLING.minLevel}`}>Сенчестите пратки се отключват от ниво {SMUGGLING.minLevel}. Ти си ниво {user.level}.</Empty>
        </Card>
      ) : (
        <Card title="Твоят избор" actions={<Badge tone={profile.optIn ? 'violet' : 'neutral'}>{profile.optIn ? 'включено' : 'изключено'}</Badge>}>
          <p className="mb-3 text-sm text-mist-300">{profile.optIn ? 'Виждаш вечерните оферти. Можеш да ги изключиш по всяко време — отворените оферти изчезват.' : 'Изключено е: не виждаш сенчести оферти и играта е само честна. Включваш го тук или в Настройки.'}</p>
          <ActionButton action={{ type: 'smugglingOptIn', on: !profile.optIn }} className={profile.optIn ? 'btn-ghost px-3 py-1.5 text-sm' : 'btn-primary px-3 py-1.5 text-sm'} confirm={profile.optIn ? undefined : 'Да включим ли сенчестите пратки? Рискът е твой — глоба и конфискация при проверка.'}>
            {profile.optIn ? 'Изключи сенчестите пратки' : '🌙 Включи сенчестите пратки'}
          </ActionButton>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Внимание на митницата">
          <div className="flex items-center justify-between text-sm"><Badge tone={heat.tone}>{heat.label}</Badge><span className="num">{profile.heat} / {SMUGGLING.heatMax}</span></div>
          <Meter value={profile.heat} tone="gold" className="mt-1.5" />
          <p className="mt-2 text-xs text-mist-400">Расте с всяка пратка (+{SMUGGLING.heatPerRun}, при хващане +{SMUGGLING.heatCaught}). Пада с честните курсове (−{SMUGGLING.heatHonestDrop}), само по себе си (−{SMUGGLING.heatDailyDrop} на ден) и когато докладваш оферта (−{SMUGGLING.heatReportDrop}).</p>
        </Card>
        <Card title="Подземна репутация" actions={<Badge tone="violet">{tier.name}</Badge>}>
          <div className="flex items-center justify-between text-sm"><span>{profile.underground} точки</span>{next && <span className="text-xs text-mist-400">до „{next.name}“: {next.min - profile.underground}</span>}</div>
          {next && <Meter value={((profile.underground - tier.min) / (next.min - tier.min)) * 100} tone="violet" className="mt-1.5" />}
          <p className="mt-2 text-xs text-mist-300">{tier.perk}</p>
          <p className="mt-1 text-xs text-mist-400">Пратки: {profile.runs} · хванати: {profile.caught} · докладвани: {profile.reports}. Честната репутация на компанията е отделна — {Math.floor(company.reputation)}.</p>
        </Card>
      </div>

      {active && (
        <Card title={<span className="inline-flex items-center gap-2"><Moon className="h-4 w-4 text-violet-300" />Вечерни оферти</span>}>
          {offers.length === 0 ? (
            <Empty icon={Moon} title="Няма оферти сега">Офертите идват вечер ({SMUGGLING.eveningFrom}:00–24:00) за градовете, където имаш свой камион.</Empty>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {offers.map((o) => {
                const borders = routeRows.find((r) => r.id === o.routeId)?.borders.length ?? 0;
                const contact = view.contacts.find((c) => c.cityId === o.originCityId);
                const risk = (compartment: boolean) => Math.round(runCatchChance(borders, borderCheckChance({ heat: profile.heat, policeReports: 0, compartment, contactLevel: contact?.level ?? 0 })) * 100);
                const options = own.map((v) => {
                  const error = compatibilityError({ modelId: v.modelId, trailerModelId: v.trailer?.modelId ?? null, condition: v.condition, hasDriver: !!v.driver, status: v.status, trailerCondition: v.trailer?.condition ?? null }, { cargoType: o.cargoType, weightTons: o.weightTons, minLevel: o.minLevel }, user.level) ?? compartmentError(v, v.trailer?.modelId ?? null, o.weightTons);
                  return { value: v.id, label: `${v.plate} · ${v.city.nameBg}${v.hiddenCompartment ? ' · 🕳️' : ''}${error ? ' (не става)' : ''}`, disabled: !!error };
                });
                return (
                  <li key={o.id} className="flex flex-col rounded-2xl border border-violet-500/30 bg-asphalt-850 p-4">
                    <div className="font-semibold">{o.goods}</div>
                    <div className="text-xs text-mist-400">{o.shipper} · {o.weightTons} т</div>
                    <div className="mt-2 inline-flex flex-wrap items-center gap-1.5 text-sm">
                      <span className="font-semibold">{city(o.originCityId)?.nameBg}</span><ArrowRight className="h-3.5 w-3.5 text-mist-400" /><span className="font-semibold">{city(o.destCityId)?.nameBg}</span><span className="text-mist-400">· {km(o.distanceKm)}</span>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                      <div><dt className="label">Плащане</dt><dd className="num text-profit">{money(o.rewardCents)}</dd></div>
                      <div><dt className="label">Граници</dt><dd className="num">{borders}</dd></div>
                      <div><dt className="label">Риск</dt><dd className="num">~{risk(false)} %<span className="text-xs text-mist-400"> (с отделение ~{risk(true)} %)</span></dd></div>
                      <div><dt className="label">Глоба при проверка</dt><dd className="num text-loss">до {money(Math.round(o.rewardCents * SMUGGLING.fineShare))}</dd></div>
                    </dl>
                    {contact && <div className="mt-2 text-xs text-violet-300">Контакт в {contact.city}: ниво {contact.level} (по-добро плащане, по-малък риск)</div>}
                    <p className="mt-1 text-[11px] text-mist-500">Полицейските сигнали по пътя вдигат риска. Офертата важи до {dateTime(o.expiresAt)}.</p>
                    <div className="mt-auto space-y-2 pt-3">
                      {own.length ? <SelectAction label="Тръгни" ariaLabel={`Камион за ${o.goods}`} value="" options={[{ value: '', label: '— свой камион —' }, ...options]} action={{ type: 'acceptContract', contractId: o.id }} field="vehicleId" /> : <p className="text-xs text-mist-400">Нужен е свой камион — с нает не става.</p>}
                      <ActionButton action={{ type: 'reportShady', contractId: o.id }} className="btn-ghost px-3 py-1.5 text-xs"><ShieldCheck className="h-3.5 w-3.5" />Докладвай на митницата (+{SMUGGLING.reportReputation} репутация)</ActionButton>
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
          <Card title="Черен пазар">
            {own.length === 0 ? <p className="text-sm text-mist-400">Нямаш свой камион.</p> : (
              <ul className="space-y-3 text-sm">
                {own.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span><span className="font-medium">{v.plate}</span> <span className="text-mist-400">· {v.model.name} · {Math.round(v.condition)} %</span></span>
                    <span className="flex flex-wrap gap-2">
                      {v.hiddenCompartment ? <Badge tone="violet">🕳️ тайно отделение</Badge> : <ActionButton action={{ type: 'buyCompartment', vehicleId: v.id }} disabled={tier.tier < 1 || v.status !== 'idle'} confirm={`Тайно отделение за ${money(SMUGGLING.compartmentPriceCents)}? Взима ${SMUGGLING.compartmentPayloadTons} т от товароносимостта.`} className="btn-ghost px-2.5 py-1 text-xs">Тайно отделение · {money(SMUGGLING.compartmentPriceCents)}</ActionButton>}
                      <ActionButton action={{ type: 'blackRepair', vehicleId: v.id }} disabled={tier.tier < 2 || v.status !== 'idle' || v.condition >= 100} className="btn-ghost px-2.5 py-1 text-xs">Ремонт „на тъмно“ −{Math.round((1 - SMUGGLING.blackRepairShare) * 100)} %</ActionButton>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-mist-400">Тайното отделение (от „{UNDERGROUND_TIERS[1].name}“) намалява шанса за находка наполовина, но взима {SMUGGLING.compartmentPayloadTons} т. Евтиният ремонт (от „{UNDERGROUND_TIERS[2].name}“) се забелязва: +{SMUGGLING.blackRepairHeat} внимание.</p>
          </Card>
          <Card title="Контакти">
            {view.contacts.length === 0 ? <p className="text-sm text-mist-400">Всяка успешна пратка от един град ти дава познат там. На всеки {SMUGGLING.contactRunsPerLevel} пратки контактът расте.</p> : (
              <ul className="space-y-1 text-sm">
                {view.contacts.map((c) => <li key={c.cityId} className="flex justify-between"><span>{c.city}</span><span className="text-xs text-mist-400">ниво {contactLevel(c.runs)} · {c.runs} пратки</span></li>)}
              </ul>
            )}
          </Card>
        </div>
      )}

      {view.last.length > 0 && (
        <Card title="Последни пратки">
          <ul className="divide-y divide-asphalt-800 text-sm">
            {view.last.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                <span className="text-mist-300">{dateTime(c.at)} · {c.borders} {c.borders === 1 ? 'граница' : 'граници'}</span>
                {c.caught ? <Badge tone="red">хваната{c.fineCents ? ` · ${money(c.fineCents)}` : ''}</Badge> : <Badge tone="green">мина</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="text-xs text-mist-500">Всичко тук е игра: измислени стоки, игрови пари и игрови данни.</p>
    </div>
  );
}
