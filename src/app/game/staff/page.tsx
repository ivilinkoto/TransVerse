import { Hint } from '@/components/game/Hint';
import { canHireStaff } from '@/server/game/company';
import { Moon, Plus, UserPlus, UserRound, Users } from 'lucide-react';
import { Badge, Card, Empty, Meter, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { SelectAction } from '@/components/ui/SelectAction';
import { int, money } from '@/lib/format';
import { CompanyRequired } from '@/components/game/CompanyRequired';
import { CREW_RULES, TRAIT_IDS, TRAIT_MAX, TRAITS, dutyAt, restLeftMin, traitLevel, traitPointsLeft } from '@/lib/game/crew';
import { gameContext } from '@/server/game/context';
import { loyaltyLabel, marketSalaryCents, MOODS, REQUEST_TEXT, type DriverRequest } from '@/lib/game/moods';
import { fleetView } from '@/server/game/queries';
import { candidates } from '@/server/game/staff';
import { tachograph } from '@/server/game/tachograph';

export const metadata = { title: 'Шофьори' };

const Stars = ({ n }: { n: number }) => <span className="text-gold-400" aria-label={`Умение ${n} от 5`}>{'★'.repeat(n)}<span className="text-asphalt-500">{'★'.repeat(5 - n)}</span></span>;

const hours = (min: number) => `${Math.floor(min / 60)} ч${Math.round(min % 60) ? ` ${Math.round(min % 60)} мин` : ''}`;

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ driver?: string }> }) {
  const { driver: focus } = await searchParams;
  const { db, user, company, now, features } = await gameContext();
  if (!(await canHireStaff(db, user.id, company))) return <CompanyRequired what="Наемането на шофьори" />;
  const [fleet, pool] = await Promise.all([fleetView(db, company.id), candidates(db, company.id)]);
  // The tachograph (v1.5): driving and rest by day for each driver.
  const tacho = features.tachograph ? new Map(await Promise.all(fleet.drivers.map(async (d) => [d.id, await tachograph(db, d.id, now)] as const))) : null;
  const payroll = fleet.drivers.reduce((s, d) => s + d.salaryCentsPerDay, 0);
  const label = (v: (typeof fleet.vehicles)[number]) => `${v.plate} · ${v.model.name}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Шофьори"
        subtitle={`Наети шофьори, които карат вместо теб. Дневни заплати: ${money(payroll)}`}
        help={`Шофьорът може да кара 9 часа преди дневна почивка. Часовете от последния курс се пренасят: ако го пратиш веднага пак, ще спре за почивка по-рано и курсът ще е по-дълъг. След ${CREW_RULES.restGameMin} минути престой е отпочинал. Двоен екипаж (втори шофьор в същия камион) кара до 18 часа без почивки — дългите курсове стават много по-бързи. С всяко ниво на умение шофьорът получава точка за Икономичност, Безопасност или Издръжливост.`}
      />
      {!user.seenHints.includes('crew') && <Hint id="crew" />}
      <Card title={`Шофьори (${fleet.drivers.length})`}>
        {fleet.drivers.length === 0 ? (
          <Empty icon={UserRound} title="Нямате шофьори">Без шофьор превозното средство не може да тръгне. Наемете от кандидатите по-долу.</Empty>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {fleet.drivers.map((d) => {
              const main = fleet.vehicles.find((x) => x.id === d.vehicleId);
              const co = fleet.vehicles.find((x) => x.id === d.coVehicleId);
              const onTrip = main?.delivery ?? co?.delivery;
              const duty = dutyAt(d, now);
              const rest = restLeftMin(d, now);
              const points = traitPointsLeft(d.skill, d.traits);
              const mainOptions = [{ value: '', label: '— без превозно средство —' }, ...fleet.vehicles.map((v) => ({ value: v.id, label: `${label(v)}${v.driver && v.driver.id !== d.id ? ` (сега: ${v.driver.name})` : ''}`, disabled: !!v.delivery }))];
              const coOptions = [{ value: '', label: '— не е втори шофьор —' }, ...fleet.vehicles.filter((v) => v.model.kind !== 'van' && v.ownership !== 'rented').map((v) => ({ value: v.id, label: `${label(v)}${v.coDriver && v.coDriver.id !== d.id ? ` (сега: ${v.coDriver.name})` : ''}`, disabled: !!v.delivery }))];
              return (
                <li key={d.id} id={`driver-${d.id}`} className={`rounded-2xl border bg-asphalt-850 p-4 ${focus === d.id ? 'border-gold-400' : 'border-asphalt-700'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{d.name}{d.isOwner && <span className="ml-2 text-xs text-mist-400">(ти)</span>}</div>
                      <div className="mt-0.5 text-sm"><Stars n={d.skill} /> <span className="num ml-1 text-xs text-mist-400">{int(d.xp)} опит</span></div>
                    </div>
                    <div className="num shrink-0 text-right text-sm">{d.isOwner ? <span className="text-mist-400">без заплата</span> : <>{money(d.salaryCentsPerDay)}<span className="text-mist-400"> / ден</span></>}</div>
                  </div>

                  <div className="mt-3 rounded-xl bg-asphalt-900/60 p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-mist-300">Кормуване днес</span>
                      <span className={`num text-xs ${rest ? 'text-amber-sig' : 'text-profit'}`}>{rest ? <span className="inline-flex items-center gap-1"><Moon className="h-3.5 w-3.5" />{hours(duty)} · почива още {rest} мин</span> : 'отпочинал'}</span>
                    </div>
                    <Meter value={100 - (duty / CREW_RULES.soloDailyMin) * 100} className="mt-2" />
                    {rest > 0 && <p className="mt-1.5 text-xs text-mist-400">Ако тръгне сега, ще спре за почивка след {hours(Math.max(0, CREW_RULES.soloDailyMin + traitLevel(d.traits, 'long') * CREW_RULES.longBonusMin - duty))} кормуване.</p>}
                  </div>

                  {tacho && (
                    <details className="mt-3 rounded-xl bg-asphalt-900/60 p-3 text-sm">
                      <summary className="cursor-pointer text-mist-300">Тахограф (7 дни)</summary>
                      {(tacho.get(d.id) ?? []).length === 0 ? <p className="mt-2 text-xs text-mist-400">Няма курсове тази седмица.</p> : (
                        <table className="mt-2 w-full text-xs">
                          <thead><tr className="text-left text-mist-400"><th>Ден</th><th className="text-right">Каране</th><th className="text-right">Почивка</th><th className="text-right">Курсове</th></tr></thead>
                          <tbody>
                            {(tacho.get(d.id) ?? []).map((r) => (
                              <tr key={r.date} className="border-t border-asphalt-800">
                                <td className="py-1">{r.date.split('-').reverse().slice(0, 2).join('.')}{r.violations ? <span className="ml-1 text-loss" title="Без задължителната почивка">⚠ {r.violations}</span> : null}</td>
                                <td className={`num text-right ${r.driveMin > CREW_RULES.soloDailyMin ? 'text-amber-sig' : ''}`}>{hours(r.driveMin)}</td>
                                <td className="num text-right">{hours(r.restMin)}</td>
                                <td className="num text-right">{r.trips}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      <p className="mt-1 text-[11px] text-mist-400">Игрово време. ⚠ — курс без задължителната почивка (риск от глоба при проверка).</p>
                    </details>
                  )}
                  {features.driver_moods && !d.isOwner && (
                    <div className="mt-3 rounded-xl bg-asphalt-900/60 p-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-mist-300">Настроение</span>
                        <span className={`text-xs ${d.loyalty >= 60 ? 'text-profit' : d.loyalty >= 40 ? 'text-mist-300' : 'text-amber-sig'}`}>{loyaltyLabel(d.loyalty)} · <span className="num">{d.loyalty}</span>/100</span>
                      </div>
                      <Meter value={d.loyalty} className="mt-2" />
                      {d.vacationUntil && d.vacationUntil > now && <div className="mt-2"><Badge tone="orange">почивен ден до {d.vacationUntil.toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Sofia' })}</Badge></div>}
                      {d.request && (
                        <div className="mt-2 rounded-lg border border-amber-sig/40 p-2">
                          <p className="text-xs">{d.name} {REQUEST_TEXT[d.request as DriverRequest]}{d.request === 'raise' ? ` (+${Math.round(MOODS.raiseShare * 100)} %)` : d.request === 'offer' ? ` — задържа го само +${Math.round(MOODS.counterShare * 100)} % заплата` : ''}. Отговори до {MOODS.answerHours} часа.</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <ActionButton className="btn-primary" action={{ type: 'answerDriver', driverId: d.id, accept: true }}>{d.request === 'vacation' ? 'Дай почивка' : 'Вдигни заплатата'}</ActionButton>
                            <ActionButton action={{ type: 'answerDriver', driverId: d.id, accept: false }} confirm={d.request === 'offer' ? 'Шофьорът ще напусне. Сигурен ли си?' : undefined}>Откажи</ActionButton>
                          </div>
                        </div>
                      )}
                      <p className="mt-1.5 text-xs text-mist-400">Пазарна заплата за умението: {money(marketSalaryCents(d.skill))} на ден. Платен поне толкова, шофьорът става все по-лоялен (игрови данни).</p>
                    </div>
                  )}
                  <div className="mt-3 space-y-2">
                    {onTrip ? (
                      <Badge tone="cyan">на курс с {(main ?? co)!.plate}{co ? ' (втори шофьор)' : ''}</Badge>
                    ) : (
                      <>
                        <div>
                          <div className="label mb-1">Кара</div>
                          <SelectAction label="Назначи" ariaLabel={`Превозно средство за ${d.name}`} value={d.vehicleId ?? ''} options={mainOptions} action={{ type: 'assignDriver', driverId: d.id, seat: 'main' }} field="vehicleId" />
                        </div>
                        <div>
                          <div className="label mb-1 flex items-center gap-1"><Users className="h-3.5 w-3.5" />Втори шофьор (двоен екипаж)</div>
                          <SelectAction label="Назначи" ariaLabel={`Двоен екипаж за ${d.name}`} value={d.coVehicleId ?? ''} options={coOptions} action={{ type: 'assignDriver', driverId: d.id, seat: 'co' }} field="vehicleId" />
                        </div>
                      </>
                    )}
                  </div>

                  <div className="mt-3">
                    <div className="label mb-1.5 flex items-center justify-between">
                      <span>Умения</span>
                      {points > 0 && <Badge tone="gold">{points} {points === 1 ? 'свободна точка' : 'свободни точки'}</Badge>}
                    </div>
                    <ul className="space-y-1.5">
                      {TRAIT_IDS.map((t) => {
                        const lvl = traitLevel(d.traits, t);
                        return (
                          <li key={t} className="flex items-center gap-2 text-sm">
                            <span className="min-w-0 flex-1">
                              <span className="font-medium">{TRAITS[t].short}</span>
                              <span className="block text-xs text-mist-400">{TRAITS[t].perPoint} за точка</span>
                            </span>
                            <span className="flex gap-1" aria-label={`${TRAITS[t].short}: ${lvl} от ${TRAIT_MAX}`}>
                              {Array.from({ length: TRAIT_MAX }, (_, i) => <span key={i} className={`h-2.5 w-2.5 rounded-full ${i < lvl ? 'bg-cyan-glow' : 'bg-asphalt-600'}`} />)}
                            </span>
                            {points > 0 && lvl < TRAIT_MAX && (
                              <ActionButton action={{ type: 'trainDriver', driverId: d.id, trait: t }} className="btn-ghost px-2 py-1 text-xs"><Plus className="h-3.5 w-3.5" /><span className="sr-only">Добави точка в {TRAITS[t].short}</span></ActionButton>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  {!d.isOwner && (
                    <div className="mt-3 border-t border-asphalt-700 pt-3 text-right">
                      <ActionButton action={{ type: 'fireDriver', driverId: d.id }} className="btn-danger px-3 py-1.5 text-xs" confirm={`Обезщетение ${money(d.salaryCentsPerDay * 3)} Освобождаване?`} disabled={!!onTrip}>Освободи</ActionButton>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card title="Кандидати" actions={<span className="text-xs text-mist-400">Обновяват се на всеки 24 часа</span>}>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {pool.map((c) => (
            <li key={c.id} className="rounded-xl border border-asphalt-700 bg-asphalt-850 p-4">
              <div className="font-semibold">{c.name}</div>
              <div className="mt-1 text-sm"><Stars n={c.skill} /></div>
              <div className="mt-1 text-xs text-mist-400">{c.skill > 1 ? `${c.skill - 1} ${c.skill === 2 ? 'точка' : 'точки'} за умения` : 'начинаещ'}</div>
              <div className="num mt-2 text-sm text-mist-300">{money(c.salaryCentsPerDay)} / ден</div>
              <div className="mt-3">
                <ActionButton action={{ type: 'hireDriver', candidateId: c.id }} className="btn-primary px-3 py-2 text-sm"><UserPlus className="h-4 w-4" />Наеми</ActionButton>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
