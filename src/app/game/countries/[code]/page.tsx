import { Crown, Fuel, Leaf, PartyPopper, Receipt, Truck } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, Empty, PageHeader, Stat } from '@/components/ui';
import { dec, int, km, money, moneyPrecise } from '@/lib/format';
import { COUNTRY_KINGS } from '@/lib/game/europe';
import { countryOpen } from '@/lib/geo/scope';
import { gameContext } from '@/server/game/context';
import { countryInfo } from '@/server/game/countries';
import { t, tx, intlLocale } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Държава') };
}

const dayLabel = (mmdd: string) => new Date(`2000-${mmdd}T12:00:00Z`).toLocaleDateString(intlLocale(), { day: 'numeric', month: 'long', timeZone: 'UTC' });

/** v1.7: one country of the game — the roads, prices, its king and the loads into it. Game data. */
export default async function CountryPage({ params }: { params: Promise<{ code: string }> }) {
  await initLocale();
  const code = decodeURIComponent((await params).code).toUpperCase();
  const { db, user, now, features } = await gameContext();
  if (!features.country_map || !countryOpen(code, features.europe, features.open_world)) notFound();
  const c = await countryInfo(db, code, now, user.id);
  if (!c) notFound();
  return (
    <div className="space-y-6">
      <PageHeader title={tx(c.name)} subtitle={t('Пътищата, цените, кралят и товарите към държавата. Игрови данни.')} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t('Дизел днес')} value={t('{0}/л', moneyPrecise(c.fuelCents))} />
        <Stat label={t('Тол за камион')} value={c.toll.kind === 'vignette' ? t('винетка {0}', money(c.toll.cents)) : t('{0}/км', moneyPrecise(c.toll.centsPerKm))} />
        <Stat label={t('Градове')} value={int(c.cities)} />
        <Stat label={t('Посетени от теб')} value={int(c.visited ?? 0)} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t('Правила по пътя')}>
          <ul className="space-y-2 text-sm text-mist-300">
            <li className="flex gap-2"><Receipt className="mt-0.5 h-4 w-4 shrink-0 text-mist-400" />{c.toll.kind === 'vignette' ? t('Винетка веднъж на курс през държавата: {0}.', money(c.toll.cents)) : t('Тол за тежки камиони по километри: около {0}/км. Бусовете не плащат.', moneyPrecise(c.toll.centsPerKm))}</li>
            <li className="flex gap-2"><Leaf className="mt-0.5 h-4 w-4 shrink-0 text-mist-400" />{features.low_emission_zones && c.zones.length ? t('Нискоемисионни зони: {0} — дизеловите камиони плащат такса, електрическите не.', c.zones.join(', ')) : t('Няма нискоемисионни зони в играта.')}</li>
            <li className="flex gap-2"><Fuel className="mt-0.5 h-4 w-4 shrink-0 text-mist-400" />{t('Цената на дизела се мени всеки ден с до ±6 %.')}</li>
            {c.nationalDay && <li className="flex gap-2"><PartyPopper className="mt-0.5 h-4 w-4 shrink-0 text-mist-400" />{t('Национален празник: {0} ({1}).', c.nationalDay.label, dayLabel(c.nationalDay.day))}</li>}
          </ul>
        </Card>
        {features.country_kings && (
          <Card title={<span className="inline-flex items-center gap-2"><Crown className="h-4 w-4 text-gold-400" />{t('Кралят на държавата')}</span>}>
            {c.king ? (
              <p className="text-sm">👑 <Link href={`/game/players/${encodeURIComponent(c.king.username)}`} className="font-semibold hover:text-cyan-glow">{tx(c.king.username)}</Link> · <span className="num">{dec(c.king.tons)}</span>{' '}{t('т миналия месец')}</p>
            ) : (
              <p className="text-sm text-mist-400">{t('Още няма крал.')}</p>
            )}
            <p className="mt-2 text-xs text-mist-400">{t('Който докара най-много тонове до държавата за месеца (поне {0} т), носи титлата следващия месец и получава {1} TC. Този месец досега:', COUNTRY_KINGS.minTons, COUNTRY_KINGS.coins)}</p>
            {c.race.length ? (
              <ol className="mt-1 divide-y divide-white/5 text-sm">
                {c.race.map((r, i) => <li key={r.userId} className={`flex justify-between py-1.5 ${r.userId === user.id ? 'text-cyan-glow' : ''}`}><span><span className="num mr-2 text-mist-400">{i + 1}.</span>{tx(r.username)}</span><span className="num">{t('{0} т', dec(r.tons))}</span></li>)}
              </ol>
            ) : (
              <p className="mt-1 text-sm text-mist-400">{t('Никой още не е карал товар дотук този месец.')}</p>
            )}
          </Card>
        )}
      </div>
      <Card title={<span className="inline-flex items-center gap-2"><Truck className="h-4 w-4 text-profit" />{t('Най-добре платени товари към {0}', c.name)}</span>}>
        {c.loads.length ? (
          <ul className="divide-y divide-white/5 text-sm">
            {c.loads.map((l) => <li key={l.id} className="flex justify-between gap-3 py-1.5"><span className="min-w-0 truncate">{t('{0} → {1} · {2} · {3} т', l.from, l.to, l.goods, dec(l.tons))}</span><span className="num shrink-0">{km(l.km)} · {money(l.rewardCents)}</span></li>)}
          </ul>
        ) : (
          <Empty icon={Truck} title={t('Няма отворени товари')}>{t('Борсата се попълва постоянно — провери пак след малко.')}</Empty>
        )}
        <p className="mt-3 text-xs"><Link href="/game/contracts" className="text-cyan-glow hover:underline">{t('Към борсата')}</Link></p>
      </Card>
    </div>
  );
}
