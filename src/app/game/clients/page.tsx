import { Hint } from '@/components/game/Hint';
import { inArray } from 'drizzle-orm';
import { ArrowRight, CalendarClock, Handshake, Lock, Star } from 'lucide-react';
import { Badge, Card, Empty, Meter, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { SelectAction } from '@/components/ui/SelectAction';
import { WhyNot } from '@/components/game/WhyNot';
import { dateTime, duration, km, money } from '@/lib/format';
import { CARGO, type CargoType } from '@/lib/game/cargo';
import { CLIENT_RULES, clientBonusCents, clientFailReputation } from '@/lib/game/clients';
import { isVip } from '@/lib/game/vip';
import { cities } from '@/server/db/schema';
import { clientContractsOf, clientOffers } from '@/server/game/clients';
import { gameContext } from '@/server/game/context';
import { BODY_LABELS, compatibilityError } from '@/server/game/deliveries';
import { fleetView } from '@/server/game/queries';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Клиенти') };
}

export default async function ClientsPage() {
  await initLocale();
  const { db, user, company, now } = await gameContext();
  const [offers, mine, fleet] = await Promise.all([clientOffers(db, user.id, now), clientContractsOf(db, company.id), fleetView(db, company.id)]);
  const all = [...offers, ...mine.active, ...mine.history];
  const cityRows = all.length ? await db.select({ id: cities.id, nameBg: cities.nameBg, countryCode: cities.countryCode }).from(cities).where(inArray(cities.id, [...new Set(all.flatMap((c) => [c.originCityId, c.destCityId]))])) : [];
  const city = (id: number) => cityRows.find((c) => c.id === id);
  const limit = CLIENT_RULES.maxActive + (isVip(user.vipUntil, now) ? CLIENT_RULES.vipExtraActive : 0);
  const lane = (c: { originCityId: number; destCityId: number; distanceKm: number }) => (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="font-semibold">{tx(city(c.originCityId)?.nameBg)}</span>
      <ArrowRight className="h-3.5 w-3.5 text-mist-400" />
      <span className="font-semibold">{tx(city(c.destCityId)?.nameBg)}</span>
      <span className="text-mist-400">· {km(c.distanceKm)}</span>
    </span>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('Клиенти')}
        subtitle={t('Дългосрочни договори: няколко товара по една линия до срок. По-добро заплащане и бонус накрая.')}
        help={t('Фирмите-клиенти са измислени (игрови данни). Всеки товар по договора се плаща с около {0} % над борсата. Когато изпълниш всички товари до срока, получаваш бонус и +{1} репутация; закъснелите товари намаляват бонуса. Ако срокът изтече, губиш репутация. Можеш да имаш до {2} активни договора (VIP — {3}). Новите оферти идват, когато старите изтекат.', Math.round((CLIENT_RULES.rewardMultiplier - 1) * 100), CLIENT_RULES.successReputation, CLIENT_RULES.maxActive, CLIENT_RULES.maxActive + CLIENT_RULES.vipExtraActive)}
      />
      {!user.seenHints.includes('clients') && <Hint id="clients" />}

      <Card title={t('Активни договори ({0} / {1})', mine.active.length, limit)}>
        {mine.active.length === 0 ? (
          <Empty icon={Handshake} title={t('Нямаш активни договори')}>{t('Приеми оферта от клиент по-долу.')}</Empty>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {mine.active.map((c) => {
              const onRoad = mine.onRoad.get(c.id) ?? 0;
              const toSend = c.loadsTotal - c.loadsDone - onRoad;
              const leftMin = c.dueAt ? (c.dueAt.getTime() - now.getTime()) / 60_000 : 0;
              const options = fleet.vehicles.map((v) => {
                const error = compatibilityError(
                  { modelId: v.modelId, trailerModelId: v.trailer?.modelId ?? null, condition: v.condition, hasDriver: !!v.driver, status: v.status, trailerCondition: v.trailer?.condition ?? null },
                  { cargoType: c.cargoType, weightTons: c.tonsPerLoad, minLevel: 1 },
                  user.level,
                );
                return { value: v.id, label: `${v.plate} · ${v.model.name} · ${v.city.nameBg}${error ? t(' (не става)') : ''}`, disabled: !!error, error };
              });
              return (
                <li key={c.id} className="rounded-2xl border border-asphalt-700 bg-asphalt-850 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{tx(c.client)}</div>
                      <div className="text-xs text-mist-400">{t('{0} · {1} · {2} т на товар', c.goods, CARGO[c.cargoType as CargoType].label, c.tonsPerLoad)}</div>
                    </div>
                    <Badge tone={leftMin < 180 ? 'red' : 'cyan'}><CalendarClock className="h-3.5 w-3.5" />{duration(leftMin)}</Badge>
                  </div>
                  <div className="mt-2 text-sm">{lane(c)}</div>
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-mist-300">
                      <span>{t('Доставени {0} от {1}{2}{3}', c.loadsDone, c.loadsTotal, onRoad ? t(' · {0} на път', onRoad) : '', c.loadsLate ? t(' · {0} със закъснение', c.loadsLate) : '')}</span>
                      <span className="num">{t('{0} / товар', money(c.rewardPerLoadCents))}</span>
                    </div>
                    <Meter value={(c.loadsDone / c.loadsTotal) * 100} tone="cyan" className="mt-1.5" />
                    <div className="mt-1.5 text-xs text-mist-400">{t('Бонус при изпълнение:')}{' '}<span className="num text-gold-400">{money(clientBonusCents(c.bonusCents, c.loadsTotal, c.loadsLate))}</span>{' '}{t('· срок {0}', c.dueAt ? dateTime(c.dueAt) : '—')}</div>
                  </div>
                  <div className="mt-3">
                    {toSend > 0 ? (
                      <>
                        <SelectAction label={t('Изпрати товар')} ariaLabel={t('Камион за товар на {0}', c.client)} value="" options={[{ value: '', label: t('— избери камион —') }, ...options]} action={{ type: 'clientLoad', clientContractId: c.id }} field="vehicleId" />
                        <div className="mt-2"><WhyNot needs={[{ label: t('Надстройка'), value: CARGO[c.cargoType as CargoType].bodies.map((b) => BODY_LABELS[b] ?? b).join(t(' или ')) }, { label: t('Товар'), value: t('{0} т', c.tonsPerLoad) }]} blocked={options.filter((o) => o.error).map((o) => ({ label: o.label, error: o.error! }))} anyUsable={options.some((o) => !o.error)} /></div>
                      </>
                    ) : (
                      <p className="text-sm text-mist-300">{t('Всички товари са на път — договорът ще се изпълни, когато пристигнат.')}</p>
                    )}
                    <p className="mt-1.5 text-xs text-mist-400">{t('Камионът може да е в друг град — първо отива празен до {0}.', city(c.originCityId)?.nameBg)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title={t('Оферти')}>
        {offers.length === 0 ? (
          <Empty icon={Handshake} title={t('Няма нови оферти')}>{t('Клиентите ще предложат нови договори, когато сегашните оферти изтекат.')}</Empty>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {offers.map((o) => {
              const locked = company.reputation < o.minReputation;
              const total = o.rewardPerLoadCents * o.loadsTotal + o.bonusCents;
              return (
                <li key={o.id} className="flex flex-col rounded-2xl border border-asphalt-700 bg-asphalt-850 p-4">
                  <div className="font-semibold">{tx(o.client)}</div>
                  <div className="text-xs text-mist-400">{tx(o.goods)} · {tx(CARGO[o.cargoType as CargoType].label)}</div>
                  <div className="mt-2 text-sm">{lane(o)}</div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div><dt className="label">{t('Товари')}</dt><dd className="num">{t('{0} × {1} т', o.loadsTotal, o.tonsPerLoad)}</dd></div>
                    <div><dt className="label">{t('Срок')}</dt><dd className="num">{duration(o.durationHours * 60)}</dd></div>
                    <div><dt className="label">{t('На товар')}</dt><dd className="num">{money(o.rewardPerLoadCents)}</dd></div>
                    <div><dt className="label">{t('Бонус')}</dt><dd className="num text-gold-400">{money(o.bonusCents)}</dd></div>
                  </dl>
                  <div className="mt-2 text-xs text-mist-400">{t('Общо до')}{' '}<span className="num text-profit">{money(total)}</span>{t('. При провал: −{0} репутация (по-малко, ако доставиш част).', clientFailReputation(o.loadsTotal, 0))}</div>
                  {o.minReputation > 0 && (
                    <div className={`mt-2 inline-flex items-center gap-1 text-xs ${locked ? 'text-loss' : 'text-mist-300'}`}>
                      {locked ? <Lock className="h-3.5 w-3.5" /> : <Star className="h-3.5 w-3.5 text-prestige" />}{t('Нужна репутация {0}', o.minReputation)}
                    </div>
                  )}
                  <div className="mt-auto flex flex-wrap gap-2 pt-3">
                    <ActionButton action={{ type: 'clientAccept', clientContractId: o.id }} className="btn-primary px-3 py-2 text-sm" disabled={locked || mine.active.length >= limit}>{t('Приеми')}</ActionButton>
                    <ActionButton action={{ type: 'clientDecline', clientContractId: o.id }} className="btn-ghost px-3 py-2 text-sm">{t('Откажи')}</ActionButton>
                  </div>
                  <div className="mt-1.5 text-[11px] text-mist-500">{t('Офертата важи до {0}', dateTime(o.offerExpiresAt))}</div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {mine.history.length > 0 && (
        <Card title={t('Приключили договори')}>
          <ul className="divide-y divide-asphalt-800 text-sm">
            {mine.history.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0"><span className="font-medium">{tx(c.client)}</span> <span className="text-mist-400">· {tx(city(c.originCityId)?.nameBg)} → {tx(city(c.destCityId)?.nameBg)}</span></span>
                <span className="flex items-center gap-2">
                  <span className="num text-xs text-mist-400">{tx(c.loadsDone)} / {tx(c.loadsTotal)}</span>
                  <Badge tone={c.status === 'completed' ? 'green' : 'red'}>{c.status === 'completed' ? t('изпълнен') : t('неизпълнен')}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
