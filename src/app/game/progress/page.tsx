import Link from 'next/link';
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
import { t as tr, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: tr('Прогрес и постижения') };
}

const TIER = { bronze: { tone: 'orange', label: 'Бронз' }, silver: { tone: 'neutral', label: 'Сребро' }, gold: { tone: 'gold', label: 'Злато' }, prestige: { tone: 'violet', label: 'Престиж' } } as const;

export default async function ProgressPage() {
  await initLocale();
  const { db, user, company, features } = await gameContext();
  const [stats, unlocked] = await Promise.all([companyStats(db, company.id), db.select().from(achievements).where(eq(achievements.userId, user.id))]);
  const lp = levelProgress(user.xp);
  const map = new Map(unlocked.map((a) => [a.key, a.unlockedAt]));
  const unlocks = [
    ...Object.values(CARGO).map((c) => ({ level: c.minLevel, label: c.label, kind: tr('Товар') })),
    ...POWER_UNITS.map((p) => ({ level: p.minLevel, label: p.name, kind: tr('Превозно средство') })),
    ...TRAILERS.map((t) => ({ level: t.minLevel, label: t.name, kind: tr('Ремарке') })),
  ].sort((a, b) => a.level - b.level);

  return (
    <div className="space-y-6">
      <PageHeader title={tr('Постижения')} subtitle={tr('Нивото, опитът и постиженията ти.')}
        help={tr('Опитът идва от доставки — повече за дълги, тежки и навременни курсове. Наградите се дават само за проверени от сървъра действия.')} />
      {features.legacy && (
        <Link href="/game/legacy" className="block rounded-xl border border-gold-500/30 bg-gold-500/5 p-3 text-sm hover:bg-gold-500/10">
          ⭐ {tr('Наследство: започни кариерата отначало и вземи звезда за постоянен бонус.')}
        </Link>
      )}
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="label">{tr('Ниво')}</div>
            <div className="font-display text-5xl font-extrabold text-prestige">{tx(lp.level)}</div>
          </div>
          <div className="min-w-[240px] flex-1">
            <div className="flex justify-between text-sm"><span>{tr('{0} опит', user.xp)}</span><span className="text-mist-400">{tr('следващо ниво при {0}', lp.next)}</span></div>
            <Meter value={lp.share * 100} tone="violet" className="mt-2 h-2.5" />
          </div>
        </div>
      </Card>
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card title={tr('Постижения ({0} / {1})', unlocked.length, ACHIEVEMENTS.length)}>
          <ul className="grid gap-3 sm:grid-cols-2">
            {ACHIEVEMENTS.map((a) => {
              const at = map.get(a.key);
              const t = TIER[a.tier];
              return (
                <li key={a.key} className={`rounded-xl border p-4 ${at ? 'border-prestige/40 bg-prestige/5' : 'border-asphalt-700 bg-asphalt-850'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-semibold"><Award className={`h-4 w-4 ${at ? 'text-prestige' : 'text-mist-400'}`} />{tx(a.title)}</span>
                    <Badge tone={t.tone}>{tx(t.label)}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-mist-400">{tx(a.description)}</p>
                  <Meter value={a.progress(stats) * 100} tone={at ? 'violet' : 'gold'} className="mt-3" />
                  <div className="mt-2 flex justify-between text-xs text-mist-400">
                    <span>{a.rewardCents ? money(a.rewardCents) : ''}{a.rewardCents && a.rewardXp ? ' · ' : ''}{a.rewardXp ? tr('+{0} опит', a.rewardXp) : ''}{a.badge && BADGES[a.badge] ? tr(' · значка „{0}“', BADGES[a.badge]!.label) : ''}</span>
                    <span>{at ? tr('отключено {0}', date(at)) : `${Math.round(a.progress(stats) * 100)}%`}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card title={tr('Какво отключва нивото')}>
          <ul className="space-y-1.5 text-sm">
            {unlocks.map((u) => (
              <li key={`${u.kind}-${u.label}`} className="flex items-center justify-between gap-2 rounded-lg bg-asphalt-850 px-3 py-2">
                <span className="flex items-center gap-2">{lp.level >= u.level ? <Unlock className="h-3.5 w-3.5 text-profit" /> : <Lock className="h-3.5 w-3.5 text-mist-400" />}{tx(u.label)}<span className="text-xs text-mist-400">{tx(u.kind)}</span></span>
                <Badge tone={lp.level >= u.level ? 'green' : 'violet'}>{tr('ниво {0}', u.level)}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
