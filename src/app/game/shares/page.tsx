import { TrendingUp } from 'lucide-react';
import { notFound } from 'next/navigation';
import { Card, Empty, PageHeader } from '@/components/ui';
import { money } from '@/lib/format';
import { SHARES } from '@/lib/game/shares';
import { gameContext } from '@/server/game/context';
import { membershipOf } from '@/server/game/membership';
import { listingStatus, shareMarketView } from '@/server/game/shares';
import { ListCompanyButton, ShareTrade } from './SharesClient';

export const metadata = { title: 'Борса за акции' };

/** A small price line from the last 30 days. */
function Spark({ values, up }: { values: number[]; up: boolean }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${max === min ? 15 : 28 - ((v - min) / (max - min)) * 26}`).join(' ');
  return <svg viewBox="0 0 100 30" className="h-8 w-24" aria-hidden><polyline points={pts} fill="none" stroke={up ? '#2fd27a' : '#ff5a6a'} strokeWidth="2" /></svg>;
}

/** v1.8: shares of the players' companies. Game money; the price follows each company's results. */
export default async function SharesPage() {
  const { db, user, now, features } = await gameContext();
  if (!features.share_market) notFound();
  const [market, membership] = await Promise.all([shareMarketView(db, user.id, now), membershipOf(db, user.id)]);
  const own = membership && membership.company.ownerId === user.id ? await listingStatus(db, membership.company.id, now) : null;
  const holdings = market.filter((m) => m.holding);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Борса за акции"
        subtitle="Купувай дялове от компаниите на другите играчи. Цената следва резултатите им; всеки понеделник касата им плаща дивидент. Игрови пари."
        help={`Всяка листната компания има ${SHARES.total} акции; извън нея могат да се държат до ${SHARES.outsideMax}, най-много ${SHARES.perPlayerMax} на играч. Покупката плаща цената в касата на компанията (+${Math.round(SHARES.feeShare * 100)} % такса). Купените акции се продават след ${SHARES.lockDays} дни за ${Math.round(SHARES.sellShare * 100)} % от цената. Цената всеки ден се движи с до ±${Math.round(SHARES.maxDailyMove * 100)} % към (каса + ${SHARES.contributionsWeight} × вноските от курсовете за ${SHARES.windowDays} дни) / ${SHARES.total}. Дивидентът е ${Math.round(SHARES.dividendShare * 100)} % от вноските за седмицата, за дела на акциите извън компанията.`}
      />
      {own && !own.listed && (
        <Card title="Твоята компания на борсата">
          <p className="text-sm text-mist-300">Листната компания получава в касата парите от продадените акции, а всеки понеделник плаща дивиденти от касата.</p>
          {own.oldEnough && own.bigEnough ? <ListCompanyButton /> : <p className="mt-2 text-sm text-amber-sig">Нужни са поне {SHARES.minAgeDays} дни от основаването и {SHARES.minMembers} членове.</p>}
        </Card>
      )}
      {holdings.length > 0 && (
        <Card title="Моите акции">
          <ul className="divide-y divide-white/5 text-sm">
            {holdings.map((m) => {
              const gain = m.holding!.valueCents - m.holding!.costCents;
              return (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span><b>{m.name}</b> · {m.holding!.shares} акции</span>
                  <span className="num">{money(m.holding!.valueCents)} <span className={gain >= 0 ? 'text-profit' : 'text-loss'}>({gain >= 0 ? '+' : ''}{money(gain)})</span></span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <Card title="Листнати компании">
        {market.length === 0 ? (
          <Empty icon={TrendingUp} title="Още няма листнати компании">Собственик на компания на поне {SHARES.minAgeDays} дни с {SHARES.minMembers}+ членове може да я листне от тази страница.</Empty>
        ) : (
          <ul className="divide-y divide-white/5">
            {market.map((m) => (
              <li key={m.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold">{m.name}{m.tag ? <span className="ml-1 text-xs text-mist-400">[{m.tag}]</span> : null}{m.own ? <span className="ml-2 text-xs text-cyan-glow">твоята</span> : null}</div>
                    <div className="text-xs text-mist-400">Свободни: {m.free} акции</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Spark values={m.history} up={m.changeWeek >= 0} />
                    <div className="text-right">
                      <div className="num font-display text-lg font-bold">{money(m.priceCents)}</div>
                      <div className={`num text-xs ${m.changeWeek >= 0 ? 'text-profit' : 'text-loss'}`}>{m.changeWeek >= 0 ? '+' : ''}{(m.changeWeek * 100).toFixed(1)} % за седмица</div>
                    </div>
                  </div>
                </div>
                {!m.own && <ShareTrade organizationId={m.id} priceCents={m.priceCents} free={m.free} holding={m.holding} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
