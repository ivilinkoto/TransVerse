import { and, asc, gte, inArray } from 'drizzle-orm';
import { Flag, Truck, Users } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { CARGO, CARGO_TYPES } from '@/lib/game/cargo';
import { ACCESS_LABELS, CONVOYS, LEADER_TIERS, type ConvoyAccess } from '@/lib/game/convoys';
import { playableCountries } from '@/lib/geo/scope';
import { cities } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';
import { convoysFor, myConvoyStats, topLeaders } from '@/server/game/convoys';
import { membershipOf } from '@/server/game/membership';
import { fleetView } from '@/server/game/queries';
import { NewConvoy } from './ConvoyForms';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Конвои') };
}

export default async function ConvoysPage() {
  await initLocale();
  const { db, user, company, now, features } = await gameContext();
  if (!features.convoy_lobby) notFound();
  const [list, stats, leaders, fleet, member] = await Promise.all([convoysFor(db, user.id, now), myConvoyStats(db, user.id), topLeaders(db), fleetView(db, company.id), membershipOf(db, user.id)]);
  const origins = [...new Map(fleet.vehicles.map((v) => [v.city.id, { id: v.city.id, name: v.city.nameBg }])).values()];
  const big = await db.select({ id: cities.id, name: cities.nameBg, country: cities.countryCode }).from(cities).where(and(gte(cities.population, 100_000), inArray(cities.countryCode, playableCountries(!!features.europe, !!features.open_world)))).orderBy(asc(cities.countryCode), asc(cities.nameBg));
  const destinations = big.map((c) => ({ id: c.id, name: `${c.name} (${c.country})` }));
  const next = LEADER_TIERS[stats.tier.tier + 1];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('Конвои')}
        subtitle={t('Събери колона: една линия, един час на тръгване, всички пристигат заедно.')}
        help={t('Водачът избира линия, час и места. Всеки камион се включва със свой товар по линията или с част от общия товар на конвоя. В часа на тръгване всички готови камиони в града потеглят заедно и колоната кара със скоростта на най-бавния — пристигате едновременно, без пътни инциденти. Бонус при пристигане навреме: +2 % на камион (от +4 % до +12 %), още +5 %, ако всички са навреме, +2 % за водача и +1 % за опашката и разузнавача. Фирменият конвой не плаща вноска и дава ×1,5 фирмен опит. Бонусът важи за играчи от ниво {0}, до {1} пъти на ден, и само с истински товар.', CONVOYS.minLevel, CONVOYS.bonusesPerDay)}
      />
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card title={<span className="inline-flex items-center gap-2"><Truck className="h-4 w-4 text-mist-400" />{t('Отворени и на път')}</span>}>
          {list.length === 0 ? (
            <Empty icon={Truck} title={t('Няма конвои сега')}>{t('Създай своя — приятелите и компанията ще го видят.')}</Empty>
          ) : (
            <ul className="space-y-2">
              {list.map((c) => (
                <li key={c.id}>
                  <Link href={`/game/convoys/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-asphalt-700 bg-asphalt-850 p-3 hover:border-cyan-glow/50">
                    <span className="min-w-0">
                      <span className="block font-semibold">{c.title ?? `${c.from} → ${c.to}`}</span>
                      <span className="block text-xs text-mist-400">{tx(c.from)} → {tx(c.to)} · {c.kind === 'official' ? t('игрови конвой') : c.kind === 'company' ? t('фирмен · {0}', c.company ?? '') : `${c.leader ?? ''} · ${ACCESS_LABELS[c.access as ConvoyAccess]}`}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {c.kind === 'official' && <Badge tone="gold">{t('⭐ Неделен')}</Badge>}
                      {c.sharedCargo && <Badge tone="violet">{t('общ товар')}</Badge>}
                      {c.mine && <Badge tone="green">{t('ти си вътре')}</Badge>}
                      <Badge tone={c.status === 'open' ? 'cyan' : 'neutral'}>{c.status === 'open' ? `${c.ready} / ${c.seats} · ${dateTime(c.departAt)}` : t('на път · {0} камиона', c.trucks)}</Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-6">
          <Card title={<span className="inline-flex items-center gap-2"><Flag className="h-4 w-4 text-mist-400" />{t('Ти в конвоите')}</span>} actions={<Badge tone="violet">{tx(stats.tier.name)}</Badge>}>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div><dt className="label">{t('Конвои')}</dt><dd className="num">{tx(stats.convoys)}</dd></div>
              <div><dt className="label">{t('Навреме')}</dt><dd className="num">{tx(stats.onTime)}</dd></div>
              <div><dt className="label">{t('Серия без закъснение')}</dt><dd className="num">{tx(stats.streak)}</dd></div>
              <div><dt className="label">{t('Водени')}</dt><dd className="num">{tx(stats.led)}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-mist-400">{t('Водиш до {0} камиона.{1}', stats.tier.seats, next ? t(' Още {0} водени конвоя до „{1}“ ({2} места).', next.min - stats.led, next.name, next.seats) : '')}</p>
          </Card>
          <Card title={<span className="inline-flex items-center gap-2"><Users className="h-4 w-4 text-mist-400" />{t('Най-добрите водачи')}</span>}>
            {leaders.length === 0 ? <p className="text-sm text-mist-400">{t('Още няма водени конвои.')}</p> : (
              <ol className="space-y-1 text-sm">{leaders.map((l, i) => <li key={l.username} className="flex justify-between"><span>{i + 1}. {tx(l.username)}</span><span className="num text-xs text-mist-400">{t('{0} водени · {1} навреме', l.led, l.ledOnTime)}</span></li>)}</ol>
            )}
          </Card>
        </div>
      </div>
      <Card title={t('Нов конвой')}>
        {user.level < CONVOYS.minLevel ? <p className="text-sm text-mist-400">{t('Конвой се води от ниво {0}. Дотогава се включвай в чужди.', CONVOYS.minLevel)}</p> : (
          <NewConvoy origins={origins} destinations={destinations} maxSeats={stats.tier.seats} company={!!member} cargo={CARGO_TYPES.map((id) => ({ id, label: CARGO[id].label }))} />
        )}
      </Card>
    </div>
  );
}
