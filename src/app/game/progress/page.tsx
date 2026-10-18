import { eq } from 'drizzle-orm';
import { Award, Lock, Unlock } from 'lucide-react';
import { Badge, Card, Meter, PageHeader } from '@/components/ui';
import { date, money } from '@/lib/format';
import { CARGO } from '@/lib/game/cargo';
import { POWER_UNITS, TRAILERS } from '@/lib/game/catalog';
import { ACHIEVEMENTS, levelProgress } from '@/lib/game/progression';
import { BADGES } from '@/lib/game/halloween';
import { achievements } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';
import { companyStats } from '@/server/game/progression';

export const metadata = { title: 'Прогрес и постижения' };

const TIER = { bronze: { tone: 'orange', label: 'Бронз' }, silver: { tone: 'neutral', label: 'Сребро' }, gold: { tone: 'gold', label: 'Злато' }, prestige: { tone: 'violet', label: 'Престиж' } } as const;

export default async function ProgressPage() {
  const { db, user, company } = await gameContext();
  const [stats, unlocked] = await Promise.all([companyStats(db, company.id), db.select().from(achievements).where(eq(achievements.userId, user.id))]);
  const lp = levelProgress(user.xp);
  const map = new Map(unlocked.map((a) => [a.key, a.unlockedAt]));
  const unlocks = [
    ...Object.values(CARGO).map((c) => ({ level: c.minLevel, label: c.label, kind: 'Товар' })),
    ...POWER_UNITS.map((p) => ({ level: p.minLevel, label: p.name, kind: 'Превозно средство' })),
    ...TRAILERS.map((t) => ({ level: t.minLevel, label: t.name, kind: 'Ремарке' })),
  ].sort((a, b) => a.level - b.level);

  return (
    <div className="space-y-6">
      <PageHeader title="Постижения" subtitle="Нивото, опитът и постиженията ти."
        help="Опитът идва от доставки — повече за дълги, тежки и навременни курсове. Наградите се дават само за проверени от сървъра действия." />
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="label">Ниво</div>
            <div className="font-display text-5xl font-extrabold text-prestige">{lp.level}</div>
          </div>
          <div className="min-w-[240px] flex-1">
            <div className="flex justify-between text-sm"><span>{user.xp} опит</span><span className="text-mist-400">следващо ниво при {lp.next}</span></div>
            <Meter value={lp.share * 100} tone="violet" className="mt-2 h-2.5" />
          </div>
        </div>
      </Card>
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card title={`Постижения (${unlocked.length} / ${ACHIEVEMENTS.length})`}>
          <ul className="grid gap-3 sm:grid-cols-2">
            {ACHIEVEMENTS.map((a) => {
              const at = map.get(a.key);
              const t = TIER[a.tier];
              return (
                <li key={a.key} className={`rounded-xl border p-4 ${at ? 'border-prestige/40 bg-prestige/5' : 'border-asphalt-700 bg-asphalt-850'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-semibold"><Award className={`h-4 w-4 ${at ? 'text-prestige' : 'text-mist-400'}`} />{a.title}</span>
                    <Badge tone={t.tone}>{t.label}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-mist-400">{a.description}</p>
                  <Meter value={a.progress(stats) * 100} tone={at ? 'violet' : 'gold'} className="mt-3" />
                  <div className="mt-2 flex justify-between text-xs text-mist-400">
                    <span>{a.rewardCents ? money(a.rewardCents) : ''}{a.rewardCents && a.rewardXp ? ' · ' : ''}{a.rewardXp ? `+${a.rewardXp} опит` : ''}{a.badge && BADGES[a.badge] ? ` · значка „${BADGES[a.badge]!.label}“` : ''}</span>
                    <span>{at ? `отключено ${date(at)}` : `${Math.round(a.progress(stats) * 100)}%`}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card title="Какво отключва нивото">
          <ul className="space-y-1.5 text-sm">
            {unlocks.map((u) => (
              <li key={`${u.kind}-${u.label}`} className="flex items-center justify-between gap-2 rounded-lg bg-asphalt-850 px-3 py-2">
                <span className="flex items-center gap-2">{lp.level >= u.level ? <Unlock className="h-3.5 w-3.5 text-profit" /> : <Lock className="h-3.5 w-3.5 text-mist-400" />}{u.label}<span className="text-xs text-mist-400">{u.kind}</span></span>
                <Badge tone={lp.level >= u.level ? 'green' : 'violet'}>ниво {u.level}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
