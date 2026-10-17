import { ArrowDown, ArrowUp, Clock, Shield, Trophy } from 'lucide-react';
import Link from 'next/link';
import { PlayerName } from '@/components/game/PlayerName';
import { Card, Empty, PageHeader } from '@/components/ui';
import { duration, int, money } from '@/lib/format';
import { LEAGUE_GROUP_SIZE, LEAGUE_TIERS, TOP_TIER, demoteCount, leaguePrize, promoteCount } from '@/lib/game/leagues';
import { gameContext } from '@/server/game/context';
import { leagueView } from '@/server/game/leagues';

export const metadata = { title: 'Лига' };

export default async function LeaguePage() {
  const { db, user, now } = await gameContext();
  const v = await leagueView(db, user.id, now);
  const tier = LEAGUE_TIERS[v.tier]!;
  const left = Math.max(0, v.endsAt.getTime() - now.getTime());
  const n = v.members.length;
  const me = v.members.find((m) => m.me);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Седмична лига"
        subtitle="Групи до 20 играчи в твоята лига. Най-добрите се качват, последните слизат."
        help={`Точките в лигата са сезонните точки от доставките ти през седмицата (понеделник–неделя, българско време). Влизаш в група с първата си доставка за седмицата. В края първите до 5 се качват в по-горна лига, а последните до 5 слизат (в малки групи — по-малко). Първите три получават пари и ТрансКоин; по-високите лиги дават повече.`}
      />

      <section className="panel relative overflow-hidden p-5 sm:p-6" style={{ borderColor: `${tier.color}66` }}>
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full blur-3xl" style={{ background: `${tier.color}33` }} aria-hidden="true" />
        <div className="relative flex flex-wrap items-center gap-5">
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl border-2" style={{ borderColor: tier.color, background: `${tier.color}22` }}>
            <Shield className="h-10 w-10" style={{ color: tier.color }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="label">Твоята лига</div>
            <div className="font-display text-3xl font-bold" style={{ color: tier.color }}>{tier.name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-mist-300">
              <span className="inline-flex items-center gap-1"><Clock className="h-4 w-4" />остават {duration(left / 60_000)}</span>
              {me && <span>Място <span className="num font-semibold text-white">#{me.rank}</span> от {n} · <span className="num font-semibold text-gold-400">{int(me.points)}</span> точки</span>}
            </div>
          </div>
          <ol className="flex gap-1.5" aria-label="Лиги">
            {LEAGUE_TIERS.map((t, i) => (
              <li key={t.name} title={t.name} className={`flex h-9 w-9 items-center justify-center rounded-xl border text-[10px] font-bold ${i === v.tier ? 'scale-110' : 'opacity-50'}`} style={{ borderColor: t.color, color: t.color, background: i === v.tier ? `${t.color}26` : undefined }}>
                {t.name.slice(0, 2)}
              </li>
            ))}
          </ol>
        </div>
        {v.last && (
          <p className="relative mt-4 text-xs text-mist-400">Миналата седмица: {v.last.finalRank}. място в {LEAGUE_TIERS[v.last.tier]?.name} — {v.last.outcome === 'up' ? 'качи се' : v.last.outcome === 'down' ? 'слезе' : 'остана'}.</p>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card title={`Група · ${n} / ${LEAGUE_GROUP_SIZE}`} className="p-2 sm:p-3">
          {!v.joined ? (
            <Empty icon={Trophy} title="Още не си в група тази седмица">Направи една доставка и влизаш в група от {tier.name}. <Link href="/game/contracts" className="text-cyan-glow underline">Към поръчките</Link></Empty>
          ) : (
            <ol className="space-y-1">
              {v.members.map((m) => (
                <li key={m.userId} className={`flex items-center gap-3 rounded-xl px-2 py-2 sm:px-3 ${m.me ? 'ring-1 ring-volt-500/50' : ''} ${m.outcome === 'up' ? 'bg-profit/8' : m.outcome === 'down' ? 'bg-loss/8' : 'bg-asphalt-850/50'}`}>
                  <span className="num w-7 shrink-0 text-center font-display font-bold text-mist-300">{m.rank}</span>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${m.online ? 'bg-profit' : 'bg-asphalt-500'}`} />
                  <div className="min-w-0 flex-1 text-sm">
                    <PlayerName name={m.username} role={m.role} vip={m.vip} className="font-semibold" />
                    <div className="text-xs text-mist-400">ниво {m.level} · {m.deliveries} доставки</div>
                  </div>
                  {m.outcome === 'up' && <ArrowUp className="h-4 w-4 shrink-0 text-profit" aria-label="зона за качване" />}
                  {m.outcome === 'down' && <ArrowDown className="h-4 w-4 shrink-0 text-loss" aria-label="зона за слизане" />}
                  <span className="num w-16 shrink-0 text-right font-display font-bold text-gold-400">{int(m.points)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <div className="space-y-6">
          <Card title="Награди тази седмица">
            <ul className="space-y-2 text-sm">
              {[1, 2, 3].map((r) => {
                const p = leaguePrize(v.tier, r)!;
                return <li key={r} className="flex justify-between rounded-lg bg-asphalt-850 px-3 py-2"><span>{r}. място</span><span className="num text-gold-400">{money(p.cents)} + <span className="text-cyan-glow">{p.coins} TC</span></span></li>;
              })}
            </ul>
            <p className="mt-3 text-xs text-mist-400">
              {v.tier < TOP_TIER ? `Първите ${promoteCount(Math.max(n, 1))} се качват в ${LEAGUE_TIERS[v.tier + 1]!.name}. ` : 'Това е най-високата лига. '}
              {v.tier > 0 && demoteCount(n) > 0 ? `Последните ${demoteCount(n)} слизат в ${LEAGUE_TIERS[v.tier - 1]!.name}.` : ''}
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
