import Link from 'next/link';
import { weeklyLaneView } from '@/server/game/weekly-lane';
import { WEEKLY_LANE } from '@/lib/game/weekly-lane';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { and, eq, sql } from 'drizzle-orm';
import { PageHeader } from '@/components/ui';
import { SECTIONS_V2, visibleTabs } from '@/components/game/nav';
import { achievements } from '@/server/db/schema';
import { ACHIEVEMENTS } from '@/lib/game/progression';
import { isHalloween } from '@/lib/game/halloween';
import { isChristmas } from '@/lib/game/christmas';
import { isMarta } from '@/lib/game/marta';
import { isSpring } from '@/lib/game/spring';
import { isEaster } from '@/lib/game/easter';
import { dateTime } from '@/lib/format';
import { gameContext } from '@/server/game/context';
import { runningEvents } from '@/server/game/events';
import { bigRunOf, bigRunProgress } from '@/server/game/big-run';
import { currentBattle } from '@/server/game/battles';
import { membershipOf } from '@/server/game/membership';
import type { FeatureId } from '@/lib/game/features';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Състезание') };
}

/** One card per page: an icon and what it is, in one line. */
const CARDS: Record<string, { emoji: string; text: string }> = {
  '/game/halloween': { emoji: '🎃', text: 'Хелуинските мисии и наградите' },
  '/game/christmas': { emoji: '🎄', text: 'Коледните поръчки и мисии' },
  '/game/marta': { emoji: '🧶', text: 'Мартеници и пролетни мисии' },
  '/game/spring': { emoji: '🌱', text: 'Пролетните мисии' },
  '/game/easter': { emoji: '🥚', text: 'Великденските мисии и яйцата' },
  '/game/story': { emoji: '📖', text: 'Историята на TransVerse, глава по глава' },
  '/game/case': { emoji: '🕵️', text: 'Разкрий кой е взел пратката' },
  '/game/parking': { emoji: '🅿️', text: 'Мини-игра: паркирай камиона' },
  '/game/challenges': { emoji: '🎯', text: 'Предизвикателството на седмицата и Евротур' },
  '/game/leaderboards': { emoji: '🏆', text: 'Най-добрите играчи и компании' },
  '/game/league': { emoji: '📊', text: 'Седмичната лига: качи се нагоре' },
  '/game/cities': { emoji: '🏙️', text: 'Градовете растат с доставките' },
  '/game/duels': { emoji: '⚔️', text: '1 срещу 1: кой ще превози повече' },
  '/game/rally': { emoji: '🏎️', text: 'Седмичното рали' },
  '/game/cup': { emoji: '🥇', text: 'Пролетната купа' },
  '/game/player-challenges': { emoji: '🧭', text: 'Предизвикателства, пуснати от играчи' },
  '/game/cups': { emoji: '🏟️', text: 'Турнири на общността' },
  '/game/predictions': { emoji: '🔮', text: 'Познай резултатите' },
  '/game/livery': { emoji: '🎨', text: 'Конкурс за ливреи' },
  '/game/truck-contest': { emoji: '🚚', text: 'Гласувай за камион на месеца' },
  '/game/news': { emoji: '📰', text: 'Седмичникът на TransVerse' },
  '/game/ideas': { emoji: '💡', text: 'Предложи идея и гласувай' },
  '/game/progress': { emoji: '🏅', text: 'Постиженията и значките ти' },
  '/game/collection': { emoji: '🖼️', text: 'Албумът на градовете' },
  '/game/postcards': { emoji: '✉️', text: 'Картички от забележителности' },
  '/game/my-map': { emoji: '🗺️', text: 'Картата на местата, където си бил' },
};
const GROUP_ORDER = ['Днес', 'Класации', 'Общност', 'Колекции'];

/**
 * 1.2.2: „Състезание“ as one page of cards instead of 32 tabs — what runs now
 * on top, then every page by group, each with an icon, one line and (for some)
 * the player's own status.
 */
export default async function CompetePage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.nav_v2) redirect('/game/leaderboards');
  const has = (f: FeatureId) => !!features[f];
  const holiday = [isHalloween(now) && 'halloween', isChristmas(now) && 'christmas', isMarta(now) && 'marta', isSpring(now) && 'spring', isEaster(now) && 'easter'].filter(Boolean).join(',') || null;
  const section = SECTIONS_V2.find((s) => s.key === 'compete')!;
  const tabs = visibleTabs(section, holiday, '/game/compete', has, { level: user.level, showAll: !!user.uiPrefs?.showAll }).filter((x) => x.href !== '/game/compete');

  // „Тече сега“: events, the Big Run, the company's battle — with the player's own numbers.
  const m = await membershipOf(db, user.id);
  const [events, run, battle, [{ done = 0 } = {}]] = await Promise.all([
    runningEvents(db, user.id, now),
    features.big_run ? bigRunOf(db, now) : null,
    m ? currentBattle(db, m.company.id, now) : null,
    db.select({ done: sql<number>`count(*)::int` }).from(achievements).where(and(eq(achievements.userId, user.id))),
  ]);
  const runDone = run ? (await bigRunProgress(db, user.id, run)).filter(Boolean).length : 0;
  const live: { href: string; emoji: string; title: string; text: string }[] = [];
  for (const e of events.filter((x) => x.event.startsAt <= now && x.event.endsAt > now)) live.push({ href: '/game/events', emoji: '🎯', title: tx(e.event.name), text: t('до {0}', dateTime(e.event.endsAt)) });
  if (run && run.legs.length) live.push({ href: '/game/big-run', emoji: '🏁', title: t('Голям рейс'), text: t('етап {0} от {1}', Math.min(runDone + 1, run.legs.length), run.legs.length) });
  if (battle && battle.status === 'active' && battle.rival) live.push({ href: '/game/company/missions', emoji: '⚔️', title: t('Битка срещу „{0}“', battle.rival.name), text: t('{0} : {1} т', Math.round(battle.ourTons), Math.round(battle.theirTons)) });
  // 1.2.3: the contract of the week.
  const lane = features.weekly_lane ? await weeklyLaneView(db, user.id, now) : null;
  if (lane?.origin && lane.dest) live.push({ href: `/game/contracts?q=${encodeURIComponent(lane.dest.name)}`, emoji: '🏁', title: t('Договор на седмицата: {0} → {1}', tx(lane.origin.name), tx(lane.dest.name)), text: lane.mine ? t('Ти си сред победителите!') : t('+30% · места: {0} от {1}', Math.max(0, WEEKLY_LANE.winners - lane.taken), WEEKLY_LANE.winners) });
  for (const h of tabs.filter((x) => x.holiday)) live.push({ href: h.href, emoji: CARDS[h.href]?.emoji ?? '🎉', title: tx(h.label), text: tx(CARDS[h.href]?.text ?? '') });

  const status: Record<string, string> = { '/game/progress': t('{0} от {1}', done, ACHIEVEMENTS.length) };
  const groups = GROUP_ORDER.map((g) => ({ name: g, tabs: tabs.filter((x) => (x.group ?? 'Днес') === g && !x.holiday) })).filter((g) => g.tabs.length);

  return (
    <div className="space-y-6">
      <PageHeader title={t('Състезание')} subtitle={t('Класации, общност и колекции — всичко на едно място.')} />
      {live.length > 0 && (
        <section>
          <h2 className="label mb-2">{t('Тече сега')}</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {live.map((l, i) => (
              <li key={i}>
                <Link href={l.href} className="flex items-center gap-3 rounded-2xl border border-cyan-glow/40 bg-cyan-glow/5 p-3 transition hover:-translate-y-0.5">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-asphalt-850 text-2xl" aria-hidden="true">{l.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{l.title}</span>
                    <span className="block text-xs text-mist-300">{l.text}</span>
                  </span>
                  <span className="text-cyan-glow">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {groups.map((g) => (
        <section key={g.name}>
          <h2 className="label mb-2">{tx(g.name)}</h2>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" data-testid={`compete-${g.name}`}>
            {g.tabs.map((x) => (
              <li key={x.href}>
                <Link href={x.href} className="flex h-full flex-col gap-1 rounded-2xl border border-asphalt-700 bg-asphalt-900/60 p-3 transition hover:-translate-y-0.5 hover:border-cyan-glow/50">
                  <span className="text-2xl" aria-hidden="true">{CARDS[x.href]?.emoji ?? '⭐'}</span>
                  <span className="font-semibold">{tx(x.label)}</span>
                  <span className="text-xs text-mist-400">{tx(CARDS[x.href]?.text ?? '')}</span>
                  {status[x.href] && <span className="num mt-auto text-xs font-bold text-gold-400">{status[x.href]}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
