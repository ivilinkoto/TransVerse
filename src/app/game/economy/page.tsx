import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm';
import { Container, TrendingUp } from 'lucide-react';
import { notFound } from 'next/navigation';
import { Badge, Card, PageHeader } from '@/components/ui';
import { CARGO, type CargoType } from '@/lib/game/cargo';
import { CYCLE_LABELS, cycleIndex, cyclePhase, INTERMODAL } from '@/lib/game/living';
import { playableCountries } from '@/lib/geo/scope';
import { dec } from '@/lib/format';
import { cities, cityMarkets, countries } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';
import { intermodalBoard } from '@/server/game/intermodal';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Икономика и контейнери') };
}

const pct = (v: number) => `${v >= 1 ? '+' : '−'}${Math.abs(Math.round((v - 1) * 100))} %`;
const TONE = { boom: 'green', steady: 'neutral', slowdown: 'orange' } as const;

/** v2.0 the living economy: the cycle, the hungry markets, the cities short of goods, and the intermodal containers. */
export default async function EconomyPage() {
  await initLocale();
  const { db, now, features } = await gameContext();
  if (!features.living_economy) notFound();
  const codes = playableCountries(!!features.europe, !!features.open_world);
  const [names, hungry, short, board] = await Promise.all([
    db.select({ code: countries.code, nameBg: countries.nameBg }).from(countries).where(inArray(countries.code, [...codes])),
    db.select({ city: cities.nameBg, cityId: cities.id, cargo: cityMarkets.cargoType, demand: cityMarkets.demand }).from(cityMarkets).innerJoin(cities, eq(cities.id, cityMarkets.cityId)).where(and(eq(cityMarkets.consumes, true), inArray(cities.countryCode, [...codes]))).orderBy(desc(cityMarkets.demand)).limit(10),
    db.select({ city: cities.nameBg, cityId: cities.id, cargo: cityMarkets.cargoType, supply: cityMarkets.supply }).from(cityMarkets).innerJoin(cities, eq(cities.id, cityMarkets.cityId)).where(and(eq(cityMarkets.produces, true), lt(cityMarkets.supply, 1), inArray(cities.countryCode, [...codes]))).orderBy(asc(cityMarkets.supply)).limit(10),
    features.intermodal ? intermodalBoard(db) : [],
  ]);
  const global = cycleIndex(now);
  const byCountry = names.map((c) => ({ ...c, index: cycleIndex(now, c.code) })).sort((a, b) => b.index - a.index);
  const cargo = (c: string) => tx(CARGO[c as CargoType]?.label ?? c);
  return (
    <div className="space-y-6">
      <PageHeader title={t('Икономика и контейнери')} subtitle={t('Икономиката живее: цикълът на подем и спад променя цените на новите товари, градовете се насищат и изчерпват. Всичко тук е игрови данни.')} />
      <Card title={<span className="flex items-center gap-2"><TrendingUp className="h-5 w-5 text-cyan-glow" />{t('Икономическият цикъл')}</span>} actions={<Badge tone={TONE[cyclePhase(global)]}>{tx(CYCLE_LABELS[cyclePhase(global)])} · {pct(global)}</Badge>}>
        <p className="text-sm text-mist-300">{t('Бавна вълна за цялата игра (половин година) и по-бърза за всяка държава (три месеца). Новите товари до държава в подем плащат повече.')}</p>
        <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {byCountry.map((c) => (
            <li key={c.code} className="flex items-center justify-between rounded-lg border border-asphalt-700 px-3 py-2">
              <span>{tx(c.nameBg)}</span>
              <span className={`num ${c.index >= 1.04 ? 'text-profit' : c.index <= 0.96 ? 'text-loss' : 'text-mist-300'}`}>{pct(c.index)}</span>
            </li>
          ))}
        </ul>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t('Гладни пазари')}>
          <ul className="divide-y divide-asphalt-800 text-sm">
            {hungry.map((h) => <li key={`${h.cityId}-${h.cargo}`} className="flex justify-between py-2"><span>{tx(h.city)} · {cargo(h.cargo)}</span><span className="num text-gold-400">×{dec(h.demand)}</span></li>)}
          </ul>
        </Card>
        <Card title={t('Изчерпани градове')}>
          {short.length ? (
            <ul className="divide-y divide-asphalt-800 text-sm">
              {short.map((s) => <li key={`${s.cityId}-${s.cargo}`} className="flex justify-between py-2"><span>{tx(s.city)} · {cargo(s.cargo)}</span><span className="num text-loss">{Math.round(s.supply * 100)} %</span></li>)}
            </ul>
          ) : (
            <p className="text-sm text-mist-400">{t('Всички градове имат пълни складове.')}</p>
          )}
          <p className="mt-2 text-xs text-mist-400">{t('Град, от който се кара много от една стока, за известно време праща по-малко такива товари.')}</p>
        </Card>
      </div>
      {features.intermodal && (
        <Card title={<span className="flex items-center gap-2"><Container className="h-5 w-5 text-cyan-glow" />{t('Интермодални контейнери')}</span>}>
          <p className="text-sm text-mist-300">{t('Камион кара контейнера до терминал, влакът или корабът го носи по истинската линия, а последният курс от другия терминал е първо твой ({0} ч), после за всички. Всеки курс навреме: +{1} %; двата от един шофьор: +{2} %.', INTERMODAL.holdHours, Math.round(INTERMODAL.bonusShare * 100), Math.round(INTERMODAL.sameDriverShare * 100))}</p>
          <ul className="mt-3 divide-y divide-asphalt-800 text-sm">
            {board.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{tx(b.goods)} · {tx(b.from)} → {tx(b.to)}</span>
                <span className="text-xs text-mist-400">{b.line ? `${b.line.kind === 'rail' ? '🚆' : '⛴️'} ${tx(b.reversed ? b.line.bName : b.line.aName)} – ${tx(b.reversed ? b.line.aName : b.line.bName)}` : ''} · {b.status === 'leg1' ? t('чака камион до терминала') : b.status === 'on_line' ? t('по линията') : t('последен курс')}</span>
              </li>
            ))}
          </ul>
          {!board.length && <p className="text-sm text-mist-400">{t('В момента няма контейнери.')}</p>}
        </Card>
      )}
    </div>
  );
}
