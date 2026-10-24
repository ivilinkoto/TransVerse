import { ArrowDown, ArrowUp, Clock, Shield, Trophy } from 'lucide-react';
import Link from 'next/link';
import { Avatar } from '@/components/game/Avatar';
import { PlayerName } from '@/components/game/PlayerName';
import { Card, Empty, PageHeader } from '@/components/ui';
import { duration, int, money } from '@/lib/format';
import { LEAGUE_GROUP_SIZE, LEAGUE_TIERS, TOP_TIER, demoteCount, leaguePrize, promoteCount } from '@/lib/game/leagues';
import { gameContext } from '@/server/game/context';
import { leagueView } from '@/server/game/leagues';
import { t as tr, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: tr('Лига') };
}

export default async function LeaguePage() {
  await initLocale();
  const { db, user, now } = await gameContext();
  const v = await leagueView(db, user.id, now);
  const tier = LEAGUE_TIERS[v.tier]!;
  const left = Math.max(0, v.endsAt.getTime() - now.getTime());
  const n = v.members.length;
  const me = v.members.find((m) => m.me);
  return (
    <div className="space-y-6">
      <PageHeader
        title={tr('Седмична лига')}
        subtitle={tr('Групи до 20 играчи в твоята лига. Най-добрите се качват, последните слизат.')}
        help={tr('Точките в лигата са сезонните точки от доставките ти през седмицата (понеделник–неделя, българско време). Влизаш в група с първата си доставка за седмицата. В края първите до 5 се качват в по-горна лига, а последните до 5 слизат (в малки групи — по-малко). Първите три получават пари и ТрансКоин; по-високите лиги дават повече.')}
      />

      <section className="panel relative overflow-hidden p-5 sm:p-6" style={{ borderColor: `${tier.color}66` }}>
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full blur-3xl" style={{ background: `${tier.color}33` }} aria-hidden="true" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl border-2 sm:h-20 sm:w-20" style={{ borderColor: tier.color, background: `${tier.color}22` }}>
              <Shield className="h-8 w-8 sm:h-10 sm:w-10" style={{ color: tier.color }} />
            </div>
            <div className="min-w-0">
              <div className="label">{tr('Твоята лига')}</div>
              <div className="font-display text-2xl font-bold sm:text-3xl" style={{ color: tier.color }}>{tx(tier.name)}</div>
              <div className="mt-1 space-y-0.5 text-sm text-mist-300 sm:flex sm:flex-wrap sm:gap-x-4 sm:space-y-0">
                <div className="flex items-center gap-1"><Clock className="h-4 w-4 shrink-0" />{tr('остават {0}', duration(left / 60_000))}</div>
                {me && <div>{tr('Място')}{' '}<span className="num font-semibold text-white">#{tx(me.rank)}</span>{' '}{tr('от {0} ·', n)}{' '}<span className="num font-semibold text-gold-400">{int(me.points)}</span>{' '}{tr('точки')}</div>}
              </div>
            </div>
          </div>
          <ol className="flex justify-between gap-1.5 sm:justify-start" aria-label={tr('Лиги')}>
            {LEAGUE_TIERS.map((t, i) => (
              <li key={t.name} title={tx(t.name)} className={`flex h-9 min-w-9 flex-1 items-center justify-center rounded-xl border px-1 text-[10px] font-bold sm:flex-none ${i === v.tier ? 'ring-2 ring-offset-2 ring-offset-asphalt-900' : 'opacity-50'}`} style={{ borderColor: t.color, color: t.color, background: i === v.tier ? `${t.color}26` : undefined, ['--tw-ring-color' as string]: t.color }}>
                <span className="sm:hidden">{tx(t.name)}</span>
                <span className="hidden sm:inline">{t.name.slice(0, 2)}</span>
              </li>
            ))}
          </ol>
        </div>
        {v.last && (
          <p className="relative mt-4 text-xs text-mist-400">{tr('Миналата седмица: {0}. място в {1} — {2}.', v.last.finalRank, LEAGUE_TIERS[v.last.tier]?.name, v.last.outcome === 'up' ? tr('качи се') : v.last.outcome === 'down' ? tr('слезе') : tr('остана'))}</p>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card title={tr('Група · {0} / {1}', n, LEAGUE_GROUP_SIZE)} className="p-2 sm:p-3">
          {!v.joined ? (
            <Empty icon={Trophy} title={tr('Още не си в група тази седмица')}>{tr('Направи една доставка и влизаш в група от {0}.', tier.name)}{' '}<Link href="/game/contracts" className="text-cyan-glow underline">{tr('Към поръчките')}</Link></Empty>
          ) : (
            <ol className="space-y-1">
              {v.members.map((m) => (
                <li key={m.userId} className={`flex items-center gap-3 rounded-xl px-2 py-2 sm:px-3 ${m.me ? 'ring-1 ring-volt-500/50' : ''} ${m.outcome === 'up' ? 'bg-profit/8' : m.outcome === 'down' ? 'bg-loss/8' : 'bg-asphalt-850/50'}`}>
                  <span className="num w-7 shrink-0 text-center font-display font-bold text-mist-300">{tx(m.rank)}</span>
                  <span className="relative shrink-0">
                    <Avatar userId={m.userId} username={m.username} version={m.avatarVersion} vip={m.vip} className="h-8 w-8 text-xs" />
                    <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-asphalt-900 ${m.online ? 'bg-profit' : 'bg-asphalt-500'}`} />
                  </span>
                  <div className="min-w-0 flex-1 text-sm">
                    <PlayerName name={m.username} role={m.role} vip={m.vip} className="font-semibold" />
                    <div className="text-xs text-mist-400">{tr('ниво {0} · {1} доставки', m.level, m.deliveries)}</div>
                  </div>
                  {m.outcome === 'up' && <ArrowUp className="h-4 w-4 shrink-0 text-profit" aria-label={tr('зона за качване')} />}
                  {m.outcome === 'down' && <ArrowDown className="h-4 w-4 shrink-0 text-loss" aria-label={tr('зона за слизане')} />}
                  <span className="num w-16 shrink-0 text-right font-display font-bold text-gold-400">{int(m.points)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <div className="space-y-6">
          <Card title={tr('Награди тази седмица')}>
            <ul className="space-y-2 text-sm">
              {[1, 2, 3].map((r) => {
                const p = leaguePrize(v.tier, r)!;
                return <li key={r} className="flex justify-between rounded-lg bg-asphalt-850 px-3 py-2"><span>{tr('{0}. място', r)}</span><span className="num text-gold-400">{money(p.cents)} + <span className="text-cyan-glow">{tx(p.coins)} TC</span></span></li>;
              })}
            </ul>
            <p className="mt-3 text-xs text-mist-400">
              {v.tier < TOP_TIER ? tr('Първите {0} се качват в {1}. ', promoteCount(Math.max(n, 1)), LEAGUE_TIERS[v.tier + 1]!.name) : tr('Това е най-високата лига. ')}
              {v.tier > 0 && demoteCount(n) > 0 ? tr('Последните {0} слизат в {1}.', demoteCount(n), LEAGUE_TIERS[v.tier - 1]!.name) : ''}
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
