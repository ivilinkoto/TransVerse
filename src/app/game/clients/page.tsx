import { Hint } from '@/components/game/Hint';
import { inArray } from 'drizzle-orm';
import { ArrowRight, CalendarClock, Handshake, Lock, Star } from 'lucide-react';
import { Badge, Card, Empty, Meter, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { SelectAction } from '@/components/ui/SelectAction';
import { dateTime, duration, km, money } from '@/lib/format';
import { CARGO, type CargoType } from '@/lib/game/cargo';
import { CLIENT_RULES, clientBonusCents, clientFailReputation } from '@/lib/game/clients';
import { isVip } from '@/lib/game/vip';
import { cities } from '@/server/db/schema';
import { clientContractsOf, clientOffers } from '@/server/game/clients';
import { gameContext } from '@/server/game/context';
import { compatibilityError } from '@/server/game/deliveries';
import { fleetView } from '@/server/game/queries';

export const metadata = { title: 'Клиенти' };

export default async function ClientsPage() {
  const { db, user, company, now } = await gameContext();
  const [offers, mine, fleet] = await Promise.all([clientOffers(db, user.id, now), clientContractsOf(db, company.id), fleetView(db, company.id)]);
  const all = [...offers, ...mine.active, ...mine.history];
  const cityRows = all.length ? await db.select({ id: cities.id, nameBg: cities.nameBg, countryCode: cities.countryCode }).from(cities).where(inArray(cities.id, [...new Set(all.flatMap((c) => [c.originCityId, c.destCityId]))])) : [];
  const city = (id: number) => cityRows.find((c) => c.id === id);
  const limit = CLIENT_RULES.maxActive + (isVip(user.vipUntil, now) ? CLIENT_RULES.vipExtraActive : 0);
  const lane = (c: { originCityId: number; destCityId: number; distanceKm: number }) => (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="font-semibold">{city(c.originCityId)?.nameBg}</span>
      <ArrowRight className="h-3.5 w-3.5 text-mist-400" />
      <span className="font-semibold">{city(c.destCityId)?.nameBg}</span>
      <span className="text-mist-400">· {km(c.distanceKm)}</span>
    </span>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Клиенти"
        subtitle="Дългосрочни договори: няколко товара по една линия до срок. По-добро заплащане и бонус накрая."
        help={`Фирмите-клиенти са измислени (игрови данни). Всеки товар по договора се плаща с около ${Math.round((CLIENT_RULES.rewardMultiplier - 1) * 100)} % над борсата. Когато изпълниш всички товари до срока, получаваш бонус и +${CLIENT_RULES.successReputation} репутация; закъснелите товари намаляват бонуса. Ако срокът изтече, губиш репутация. Можеш да имаш до ${CLIENT_RULES.maxActive} активни договора (VIP — ${CLIENT_RULES.maxActive + CLIENT_RULES.vipExtraActive}). Новите оферти идват, когато старите изтекат.`}
      />
      {!user.seenHints.includes('clients') && <Hint id="clients" />}

      <Card title={`Активни договори (${mine.active.length} / ${limit})`}>
        {mine.active.length === 0 ? (
          <Empty icon={Handshake} title="Нямаш активни договори">Приеми оферта от клиент по-долу.</Empty>
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
                return { value: v.id, label: `${v.plate} · ${v.model.name} · ${v.city.nameBg}${error ? ` — ${error}` : ''}`, disabled: !!error };
              });
              return (
                <li key={c.id} className="rounded-2xl border border-asphalt-700 bg-asphalt-850 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{c.client}</div>
                      <div className="text-xs text-mist-400">{c.goods} · {CARGO[c.cargoType as CargoType].label} · {c.tonsPerLoad} т на товар</div>
                    </div>
                    <Badge tone={leftMin < 180 ? 'red' : 'cyan'}><CalendarClock className="h-3.5 w-3.5" />{duration(leftMin)}</Badge>
                  </div>
                  <div className="mt-2 text-sm">{lane(c)}</div>
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-mist-300">
                      <span>Доставени {c.loadsDone} от {c.loadsTotal}{onRoad ? ` · ${onRoad} на път` : ''}{c.loadsLate ? ` · ${c.loadsLate} със закъснение` : ''}</span>
                      <span className="num">{money(c.rewardPerLoadCents)} / товар</span>
                    </div>
                    <Meter value={(c.loadsDone / c.loadsTotal) * 100} tone="cyan" className="mt-1.5" />
                    <div className="mt-1.5 text-xs text-mist-400">Бонус при изпълнение: <span className="num text-gold-400">{money(clientBonusCents(c.bonusCents, c.loadsTotal, c.loadsLate))}</span> · срок {c.dueAt ? dateTime(c.dueAt) : '—'}</div>
                  </div>
                  <div className="mt-3">
                    {toSend > 0 ? (
                      <SelectAction label="Изпрати товар" ariaLabel={`Камион за товар на ${c.client}`} value="" options={[{ value: '', label: '— избери камион —' }, ...options]} action={{ type: 'clientLoad', clientContractId: c.id }} field="vehicleId" />
                    ) : (
                      <p className="text-sm text-mist-300">Всички товари са на път — договорът ще се изпълни, когато пристигнат.</p>
                    )}
                    <p className="mt-1.5 text-xs text-mist-400">Камионът може да е в друг град — първо отива празен до {city(c.originCityId)?.nameBg}.</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="Оферти">
        {offers.length === 0 ? (
          <Empty icon={Handshake} title="Няма нови оферти">Клиентите ще предложат нови договори, когато сегашните оферти изтекат.</Empty>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {offers.map((o) => {
              const locked = company.reputation < o.minReputation;
              const total = o.rewardPerLoadCents * o.loadsTotal + o.bonusCents;
              return (
                <li key={o.id} className="flex flex-col rounded-2xl border border-asphalt-700 bg-asphalt-850 p-4">
                  <div className="font-semibold">{o.client}</div>
                  <div className="text-xs text-mist-400">{o.goods} · {CARGO[o.cargoType as CargoType].label}</div>
                  <div className="mt-2 text-sm">{lane(o)}</div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div><dt className="label">Товари</dt><dd className="num">{o.loadsTotal} × {o.tonsPerLoad} т</dd></div>
                    <div><dt className="label">Срок</dt><dd className="num">{duration(o.durationHours * 60)}</dd></div>
                    <div><dt className="label">На товар</dt><dd className="num">{money(o.rewardPerLoadCents)}</dd></div>
                    <div><dt className="label">Бонус</dt><dd className="num text-gold-400">{money(o.bonusCents)}</dd></div>
                  </dl>
                  <div className="mt-2 text-xs text-mist-400">Общо до <span className="num text-profit">{money(total)}</span>. При провал: −{clientFailReputation(o.loadsTotal, 0)} репутация (по-малко, ако доставиш част).</div>
                  {o.minReputation > 0 && (
                    <div className={`mt-2 inline-flex items-center gap-1 text-xs ${locked ? 'text-loss' : 'text-mist-300'}`}>
                      {locked ? <Lock className="h-3.5 w-3.5" /> : <Star className="h-3.5 w-3.5 text-prestige" />}Нужна репутация {o.minReputation}
                    </div>
                  )}
                  <div className="mt-auto flex flex-wrap gap-2 pt-3">
                    <ActionButton action={{ type: 'clientAccept', clientContractId: o.id }} className="btn-primary px-3 py-2 text-sm" disabled={locked || mine.active.length >= limit}>Приеми</ActionButton>
                    <ActionButton action={{ type: 'clientDecline', clientContractId: o.id }} className="btn-ghost px-3 py-2 text-sm">Откажи</ActionButton>
                  </div>
                  <div className="mt-1.5 text-[11px] text-mist-500">Офертата важи до {dateTime(o.offerExpiresAt)}</div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {mine.history.length > 0 && (
        <Card title="Приключили договори">
          <ul className="divide-y divide-asphalt-800 text-sm">
            {mine.history.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0"><span className="font-medium">{c.client}</span> <span className="text-mist-400">· {city(c.originCityId)?.nameBg} → {city(c.destCityId)?.nameBg}</span></span>
                <span className="flex items-center gap-2">
                  <span className="num text-xs text-mist-400">{c.loadsDone} / {c.loadsTotal}</span>
                  <Badge tone={c.status === 'completed' ? 'green' : 'red'}>{c.status === 'completed' ? 'изпълнен' : 'неизпълнен'}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
