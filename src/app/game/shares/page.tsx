import { TrendingUp } from 'lucide-react';
import { notFound } from 'next/navigation';
import { Card, Empty, PageHeader } from '@/components/ui';
import { money } from '@/lib/format';
import { SHARES } from '@/lib/game/shares';
import { gameContext } from '@/server/game/context';
import { membershipOf } from '@/server/game/membership';
import { listingStatus, shareMarketView } from '@/server/game/shares';
import { ListCompanyButton, ShareTrade } from './SharesClient';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Борса за акции') };
}

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
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.share_market) notFound();
  const [market, membership] = await Promise.all([shareMarketView(db, user.id, now), membershipOf(db, user.id)]);
  const own = membership && membership.company.ownerId === user.id ? await listingStatus(db, membership.company.id, now) : null;
  const holdings = market.filter((m) => m.holding);
  return (
    <div className="space-y-6">
      <PageHeader
        title={t('Борса за акции')}
        subtitle={t('Купувай дялове от компаниите на другите играчи. Цената следва резултатите им; всеки понеделник касата им плаща дивидент. Игрови пари.')}
        help={t('Всяка листната компания има {0} акции; извън нея могат да се държат до {1}, най-много {2} на играч. Покупката плаща цената в касата на компанията (+{3} % такса). Купените акции се продават след {4} дни за {5} % от цената. Цената всеки ден се движи с до ±{6} % към (каса + {7} × вноските от курсовете за {8} дни) / {9}. Дивидентът е {10} % от вноските за седмицата, за дела на акциите извън компанията.', SHARES.total, SHARES.outsideMax, SHARES.perPlayerMax, Math.round(SHARES.feeShare * 100), SHARES.lockDays, Math.round(SHARES.sellShare * 100), Math.round(SHARES.maxDailyMove * 100), SHARES.contributionsWeight, SHARES.windowDays, SHARES.total, Math.round(SHARES.dividendShare * 100))}
      />
      {own && !own.listed && (
        <Card title={t('Твоята компания на борсата')}>
          <p className="text-sm text-mist-300">{t('Листната компания получава в касата парите от продадените акции, а всеки понеделник плаща дивиденти от касата.')}</p>
          {own.oldEnough && own.bigEnough ? <ListCompanyButton /> : <p className="mt-2 text-sm text-amber-sig">{t('Нужни са поне {0} дни от основаването и {1} членове.', SHARES.minAgeDays, SHARES.minMembers)}</p>}
        </Card>
      )}
      {holdings.length > 0 && (
        <Card title={t('Моите акции')}>
          <ul className="divide-y divide-white/5 text-sm">
            {holdings.map((m) => {
              const gain = m.holding!.valueCents - m.holding!.costCents;
              return (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span><b>{tx(m.name)}</b>{' '}{t('· {0} акции', m.holding!.shares)}</span>
                  <span className="num">{money(m.holding!.valueCents)} <span className={gain >= 0 ? 'text-profit' : 'text-loss'}>({gain >= 0 ? '+' : ''}{money(gain)})</span></span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <Card title={t('Листнати компании')}>
        {market.length === 0 ? (
          <Empty icon={TrendingUp} title={t('Още няма листнати компании')}>{t('Собственик на компания на поне {0} дни с {1}+ членове може да я листне от тази страница.', SHARES.minAgeDays, SHARES.minMembers)}</Empty>
        ) : (
          <ul className="divide-y divide-white/5">
            {market.map((m) => (
              <li key={m.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold">{tx(m.name)}{m.tag ? <span className="ml-1 text-xs text-mist-400">[{tx(m.tag)}]</span> : null}{m.own ? <span className="ml-2 text-xs text-cyan-glow">{t('твоята')}</span> : null}</div>
                    <div className="text-xs text-mist-400">{t('Свободни: {0} акции', m.free)}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Spark values={m.history} up={m.changeWeek >= 0} />
                    <div className="text-right">
                      <div className="num font-display text-lg font-bold">{money(m.priceCents)}</div>
                      <div className={`num text-xs ${m.changeWeek >= 0 ? 'text-profit' : 'text-loss'}`}>{t('{0}{1} % за седмица', m.changeWeek >= 0 ? '+' : '', (m.changeWeek * 100).toFixed(1))}</div>
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
