import { Crown, Fuel, Leaf, PartyPopper, Receipt, Truck } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, Empty, PageHeader, Stat } from '@/components/ui';
import { dec, int, km, money, moneyPrecise } from '@/lib/format';
import { COUNTRY_KINGS } from '@/lib/game/europe';
import { isEuropeCountry } from '@/lib/geo/scope';
import { gameContext } from '@/server/game/context';
import { countryInfo } from '@/server/game/countries';

export const metadata = { title: 'Държава' };

const dayLabel = (mmdd: string) => new Date(`2000-${mmdd}T12:00:00Z`).toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', timeZone: 'UTC' });

/** v1.7: one country of the game — the roads, prices, its king and the loads into it. Game data. */
export default async function CountryPage({ params }: { params: Promise<{ code: string }> }) {
  const code = decodeURIComponent((await params).code).toUpperCase();
  const { db, user, now, features } = await gameContext();
  if (!features.country_map || (isEuropeCountry(code) && !features.europe)) notFound();
  const c = await countryInfo(db, code, now, user.id);
  if (!c) notFound();
  return (
    <div className="space-y-6">
      <PageHeader title={c.name} subtitle="Пътищата, цените, кралят и товарите към държавата. Игрови данни." />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Дизел днес" value={`${moneyPrecise(c.fuelCents)}/л`} />
        <Stat label="Тол за камион" value={c.toll.kind === 'vignette' ? `винетка ${money(c.toll.cents)}` : `${moneyPrecise(c.toll.centsPerKm)}/км`} />
        <Stat label="Градове" value={int(c.cities)} />
        <Stat label="Посетени от теб" value={int(c.visited ?? 0)} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Правила по пътя">
          <ul className="space-y-2 text-sm text-mist-300">
            <li className="flex gap-2"><Receipt className="mt-0.5 h-4 w-4 shrink-0 text-mist-400" />{c.toll.kind === 'vignette' ? `Винетка веднъж на курс през държавата: ${money(c.toll.cents)}.` : `Тол за тежки камиони по километри: около ${moneyPrecise(c.toll.centsPerKm)}/км. Бусовете не плащат.`}</li>
            <li className="flex gap-2"><Leaf className="mt-0.5 h-4 w-4 shrink-0 text-mist-400" />{features.low_emission_zones && c.zones.length ? `Нискоемисионни зони: ${c.zones.join(', ')} — дизеловите камиони плащат такса, електрическите не.` : 'Няма нискоемисионни зони в играта.'}</li>
            <li className="flex gap-2"><Fuel className="mt-0.5 h-4 w-4 shrink-0 text-mist-400" />Цената на дизела се мени всеки ден с до ±6 %.</li>
            {c.nationalDay && <li className="flex gap-2"><PartyPopper className="mt-0.5 h-4 w-4 shrink-0 text-mist-400" />Национален празник: {c.nationalDay.label} ({dayLabel(c.nationalDay.day)}).</li>}
          </ul>
        </Card>
        {features.country_kings && (
          <Card title={<span className="inline-flex items-center gap-2"><Crown className="h-4 w-4 text-gold-400" />Кралят на държавата</span>}>
            {c.king ? (
              <p className="text-sm">👑 <Link href={`/game/players/${encodeURIComponent(c.king.username)}`} className="font-semibold hover:text-cyan-glow">{c.king.username}</Link> · <span className="num">{dec(c.king.tons)}</span> т миналия месец</p>
            ) : (
              <p className="text-sm text-mist-400">Още няма крал.</p>
            )}
            <p className="mt-2 text-xs text-mist-400">Който докара най-много тонове до държавата за месеца (поне {COUNTRY_KINGS.minTons} т), носи титлата следващия месец и получава {COUNTRY_KINGS.coins} TC. Този месец досега:</p>
            {c.race.length ? (
              <ol className="mt-1 divide-y divide-white/5 text-sm">
                {c.race.map((r, i) => <li key={r.userId} className={`flex justify-between py-1.5 ${r.userId === user.id ? 'text-cyan-glow' : ''}`}><span><span className="num mr-2 text-mist-400">{i + 1}.</span>{r.username}</span><span className="num">{dec(r.tons)} т</span></li>)}
              </ol>
            ) : (
              <p className="mt-1 text-sm text-mist-400">Никой още не е карал товар дотук този месец.</p>
            )}
          </Card>
        )}
      </div>
      <Card title={<span className="inline-flex items-center gap-2"><Truck className="h-4 w-4 text-profit" />Най-добре платени товари към {c.name}</span>}>
        {c.loads.length ? (
          <ul className="divide-y divide-white/5 text-sm">
            {c.loads.map((l) => <li key={l.id} className="flex justify-between gap-3 py-1.5"><span className="min-w-0 truncate">{l.from} → {l.to} · {l.goods} · {dec(l.tons)} т</span><span className="num shrink-0">{km(l.km)} · {money(l.rewardCents)}</span></li>)}
          </ul>
        ) : (
          <Empty icon={Truck} title="Няма отворени товари">Борсата се попълва постоянно — провери пак след малко.</Empty>
        )}
        <p className="mt-3 text-xs"><Link href="/game/contracts" className="text-cyan-glow hover:underline">Към борсата</Link></p>
      </Card>
    </div>
  );
}
