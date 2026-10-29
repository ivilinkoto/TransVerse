import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { Award, Lock, Unlock } from 'lucide-react';
import { Badge, Card, Meter, PageHeader } from '@/components/ui';
import { date, money } from '@/lib/format';
import { CARGO } from '@/lib/game/cargo';
import { modelAvailable, POWER_UNITS, TRAILERS } from '@/lib/game/catalog';
import { ACHIEVEMENT_TIERS, ACHIEVEMENTS, levelProgress } from '@/lib/game/progression';
import { achievementRarity, topCollectors } from '@/server/game/achievement-stats';
import { cached } from '@/server/cache';
import { playerMedals } from '@/server/game/medals';
import { MEDAL_INFO, MEDALS, PLAYER_MEDAL_PLACES, medalCounts } from '@/lib/game/medals';
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

const TIER = { bronze: { tone: 'orange', label: 'Бронз', icon: '🥉', title: 'Бронзови' }, silver: { tone: 'neutral', label: 'Сребро', icon: '🥈', title: 'Сребърни' }, gold: { tone: 'gold', label: 'Злато', icon: '🥇', title: 'Златни' }, prestige: { tone: 'violet', label: 'Престиж', icon: '💎', title: 'Престижни' } } as const;

export default async function ProgressPage() {
  await initLocale();
  const { db, user, company, features, now } = await gameContext();
  const tiered = features.more_achievements;
  const [stats, unlocked, rarity, collectors, medals] = await Promise.all([
    companyStats(db, company.id),
    db.select().from(achievements).where(eq(achievements.userId, user.id)),
    // 1.1.3.1: how rare each one is, and who has the most (the same for everyone — kept for 5 minutes).
    tiered ? cached('achievements:rarity', 300_000, () => achievementRarity(db), now.getTime()) : Promise.resolve(new Map<string, number>()),
    tiered ? cached('achievements:collectors', 300_000, () => topCollectors(db), now.getTime()) : Promise.resolve([]),
    features.season_medals ? playerMedals(db, user.id) : null,
  ]);
  const medalTotals = medalCounts((medals ?? []).map((m) => m.medal));
  // Achievements of a later release appear with it (staff earlier).
  const list = ACHIEVEMENTS.filter((a) => !a.since || features[a.since]);
  const lp = levelProgress(user.xp);
  const map = new Map(unlocked.map((a) => [a.key, a.unlockedAt]));
  const unlocks = [
    ...Object.values(CARGO).map((c) => ({ level: c.minLevel, label: c.label, kind: tr('Товар') })),
    ...POWER_UNITS.filter((p) => modelAvailable(p, (f) => features[f])).map((p) => ({ level: p.minLevel, label: p.name, kind: tr('Превозно средство') })),
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
        <div className="space-y-6">
        {(tiered ? ACHIEVEMENT_TIERS.map((tier) => ({ tier, items: list.filter((a) => a.tier === tier) })) : [{ tier: null, items: list }]).map(({ tier, items }) => (
        <Card key={tier ?? 'all'} title={tier ? tr('{0} {1} ({2} / {3})', TIER[tier].icon, tr(TIER[tier].title), items.filter((a) => map.has(a.key)).length, items.length) : tr('Постижения ({0} / {1})', unlocked.length, list.length)}>
          <ul className="grid gap-3 sm:grid-cols-2">
            {items.map((a) => {
              const at = map.get(a.key);
              const t = TIER[a.tier];
              const rare = rarity.get(a.key);
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
                  {tiered && <div className="mt-1 text-[11px] text-mist-500">{rare === undefined || rare === 0 ? tr('Още никой го няма — бъди първият!') : rare < 0.05 ? tr('Рядко: имат го {0}% от играчите', (rare * 100).toFixed(1)) : tr('Имат го {0}% от играчите', Math.round(rare * 100))}</div>}
                </li>
              );
            })}
          </ul>
        </Card>
        ))}
        </div>
        <div className="space-y-6">
        {medals && (
          <Card title={tr('Сезонни медали')}>
            <div className="grid grid-cols-3 gap-2 text-center">
              {MEDALS.map((m) => (
                <div key={m} className="rounded-xl bg-asphalt-850 px-2 py-2">
                  <div className="text-2xl">{MEDAL_INFO[m].icon}</div>
                  <div className="num font-display text-lg font-bold">{medalTotals[m]}</div>
                  <div className="text-[11px] text-mist-400">{m === 'gold' ? tr('места 1–{0}', PLAYER_MEDAL_PLACES.gold) : m === 'silver' ? tr('места {0}–{1}', PLAYER_MEDAL_PLACES.gold + 1, PLAYER_MEDAL_PLACES.silver) : tr('места {0}–{1}', PLAYER_MEDAL_PLACES.silver + 1, PLAYER_MEDAL_PLACES.bronze)}</div>
                </div>
              ))}
            </div>
            {medals.length ? (
              <ul className="mt-3 space-y-1 text-sm">
                {medals.slice(0, 8).map((m) => <li key={m.seasonId} className="flex justify-between rounded-lg bg-asphalt-850 px-3 py-1.5"><span>{MEDAL_INFO[m.medal].icon} {tx(m.name)}</span><span className="num text-mist-400">{tr('{0}. място', m.rank ?? 0)}</span></li>)}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-mist-400">{tr('Завърши сезон в топ {0} на класацията, за да спечелиш първия си медал. Медалите се виждат в профила ти и можеш да ги сложиш във витрината.', PLAYER_MEDAL_PLACES.bronze)}</p>
            )}
            <Link href="/game/seasons" className="mt-2 inline-block text-xs text-cyan-glow hover:underline">{tr('Към сезона →')}</Link>
          </Card>
        )}
        {tiered && collectors.length > 0 && (
          <Card title={tr('Колекционери')}>
            <ol className="space-y-1.5 text-sm">
              {collectors.map((c, i) => (
                <li key={c.userId} className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 ${c.userId === user.id ? 'bg-cyan-glow/10' : 'bg-asphalt-850'}`}>
                  <span><span className="num mr-2 text-mist-400">{i + 1}.</span>{i < 3 ? ['🥇', '🥈', '🥉'][i] + ' ' : ''}{tx(c.username)}</span>
                  <span className="num text-gold-400">{tr('{0} постижения', c.n)}</span>
                </li>
              ))}
            </ol>
          </Card>
        )}
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
    </div>
  );
}
