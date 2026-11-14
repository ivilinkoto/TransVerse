import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui';
import { PLAY_GROUP_NAMES, SECTIONS_V3, visibleTabs } from '@/components/game/nav';
import { navEmoji } from '@/components/game/nav-emoji';
import { ACHIEVEMENTS } from '@/lib/game/progression';
import { isHalloween } from '@/lib/game/halloween';
import { isChristmas } from '@/lib/game/christmas';
import { isMarta } from '@/lib/game/marta';
import { isSpring } from '@/lib/game/spring';
import { isEaster } from '@/lib/game/easter';
import type { FeatureId } from '@/lib/game/features';
import { gameContext } from '@/server/game/context';
import { liveNow, rewardsToTake } from '@/server/game/play-hub';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Игри и награди') };
}

/** What each page is, in one line (the card under its name). */
const ABOUT: Record<string, string> = {
  '/game/halloween': 'Хелуинските мисии и наградите',
  '/game/christmas': 'Коледните поръчки и мисии',
  '/game/marta': 'Мартеници и пролетни мисии',
  '/game/spring': 'Пролетните мисии',
  '/game/easter': 'Великденските мисии и яйцата',
  '/game/missions': 'Дневни, седмични и сезонни',
  '/game/seasons': 'Сезонът и пропускът с награди',
  '/game/inventory': 'Предмети и кейсове',
  '/game/events': 'Общи цели за всички играчи',
  '/game/inventory/workshop': 'Сглоби по-редки предмети',
  '/game/inventory/album': 'Колекции от предмети',
  '/game/inventory/hall': 'Първите колекционери',
  '/game/daily-route': 'Пъзел: най-краткият път',
  '/game/night-run': 'Аркадно каране нощем',
  '/game/courier': 'Колети по истински улици',
  '/game/big-run': 'Седмичният маршрут',
  '/game/parking': 'Паркирай камиона',
  '/game/challenges': 'Предизвикателството на седмицата',
  '/game/story': 'Историята, глава по глава',
  '/game/case': 'Разкрий кой е взел пратката',
  '/game/crisis': 'Кризата на картата и гласуване',
  '/game/road-service': 'Отвори затворените проходи',
  '/game/leaderboards': 'Най-добрите играчи и компании',
  '/game/league': 'Седмичната лига',
  '/game/winter-games': 'Компаниите се състезават',
  '/game/duels': '1 срещу 1',
  '/game/rally': 'Седмичното рали',
  '/game/cities': 'Градовете растат с доставките',
  '/game/cup': 'Пролетната купа',
  '/game/news': 'Седмичникът на TransVerse',
  '/game/ideas': 'Предложи идея и гласувай',
  '/game/player-challenges': 'Пуснати от играчи',
  '/game/cups': 'Турнири на общността',
  '/game/predictions': 'Познай резултатите',
  '/game/livery': 'Конкурс за ливреи',
  '/game/truck-contest': 'Камион на месеца',
  '/game/progress': 'Постижения и значки',
  '/game/collection': 'Албумът на градовете',
  '/game/postcards': 'Картички от забележителности',
  '/game/my-map': 'Където си бил',
};

/** Groups drawn as small icons instead of cards. */
const COMPACT_GROUPS = ['Състезания', 'Общност', 'Колекции'];

/**
 * 1.3.2 „Игри и награди“: one start page for everything the player plays and collects —
 * rewards to take and what runs now on top, then every page as a card by group.
 * It replaces „Награди“ and „Състезание“.
 */
export default async function PlayPage() {
  await initLocale();
  const ctx = await gameContext();
  const { user, now, features } = ctx;
  if (!features.simple_menu) redirect(features.nav_v2 ? '/game/rewards' : '/game/missions');
  const has = (f: FeatureId) => !!features[f];
  const holiday = [isHalloween(now) && 'halloween', isChristmas(now) && 'christmas', isMarta(now) && 'marta', isSpring(now) && 'spring', isEaster(now) && 'easter'].filter(Boolean).join(',') || null;
  const section = SECTIONS_V3.find((s) => s.key === 'compete')!;
  const tabs = visibleTabs(section, holiday, '/game/play', has, { level: user.level, showAll: !!user.uiPrefs?.showAll }).filter((x) => x.href !== '/game/play');
  const [{ take, missions, pass, inv }, { live, achievementsDone }] = await Promise.all([rewardsToTake(ctx), liveNow(ctx)]);

  // The player's own status on some cards.
  const status: Record<string, string> = {
    '/game/progress': t('{0} от {1}', achievementsDone, ACHIEVEMENTS.length),
    ...(missions ? { '/game/missions': t('{0} за взимане', missions) } : {}),
    ...(pass ? { '/game/seasons': t('Ниво {0}', pass.level) } : {}),
    ...(inv?.fresh ? { '/game/inventory': t('{0} нови', inv.fresh) } : {}),
  };
  const groups = PLAY_GROUP_NAMES.map((name) => ({ name, tabs: tabs.filter((x) => x.group === name) })).filter((g) => g.tabs.length);

  return (
    <div className="space-y-6">
      <PageHeader title={t('Игри и награди')} subtitle={t('Наградите, мини-игрите, състезанията и колекциите — на едно място.')} />
      {(take.length > 0 || live.length > 0) && (
        <section>
          <h2 className="label mb-2">{t('Сега')}</h2>
          <ul className="grid gap-2 sm:grid-cols-2" data-testid="play-now">
            {take.map((x) => (
              <li key={x.text}>
                <Link href={x.href} className="flex items-center gap-3 rounded-2xl border border-gold-400/50 bg-gold-400/5 p-3 transition hover:-translate-y-0.5">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-asphalt-850 text-2xl" aria-hidden="true">{x.emoji}</span>
                  <span className="min-w-0 flex-1 font-semibold">{x.text}</span>
                  <span className="text-sm font-bold text-gold-400">{t('Вземи')} →</span>
                </Link>
              </li>
            ))}
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
      {groups.map((g) => {
        // The groups a player opens less often are a compact grid of icons, so the page stays short.
        const compact = COMPACT_GROUPS.includes(g.name);
        return (
          <section key={g.name}>
            <h2 className="label mb-2">{g.name === 'Сега' ? t('Празници') : tx(g.name)}</h2>
            <ul className={compact ? 'grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6' : 'grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4'} data-testid={`play-${g.name}`}>
              {g.tabs.map((x) => (
                <li key={x.href}>
                  {compact ? (
                    <Link href={x.href} className="flex h-full flex-col items-center justify-center gap-1 rounded-2xl border border-asphalt-700 bg-asphalt-900/60 px-2 py-3 text-center text-xs font-medium transition hover:border-cyan-glow/50">
                      <span className="text-xl" aria-hidden="true">{navEmoji(x.href) ?? '⭐'}</span>
                      {tx(x.label)}
                      {status[x.href] && <span className="num text-[10px] font-bold text-gold-400">{status[x.href]}</span>}
                    </Link>
                  ) : (
                    <Link href={x.href} className="flex h-full flex-col gap-1 rounded-2xl border border-asphalt-700 bg-asphalt-900/60 p-3 transition hover:-translate-y-0.5 hover:border-cyan-glow/50">
                      <span className="text-2xl" aria-hidden="true">{navEmoji(x.href) ?? '⭐'}</span>
                      <span className="font-semibold">{tx(x.label)}</span>
                      {ABOUT[x.href] && <span className="text-xs text-mist-400">{tx(ABOUT[x.href]!)}</span>}
                      {status[x.href] && <span className="num mt-auto text-xs font-bold text-gold-400">{status[x.href]}</span>}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
