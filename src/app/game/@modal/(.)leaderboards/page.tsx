import Page from '../../leaderboards/page';
import { RouteWindow } from '@/components/gameui/RouteWindow';
import { gameContext } from '@/server/game/context';
import { windowsLive } from '@/server/game/tutorial-flags';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

/** 1.3 „Нов облик“: from inside the game this section opens as a game window over the current page. */
export default async function LeaderboardsWindow({ searchParams }: { searchParams: Promise<{ tab?: string; country?: string }> }) {
  await initLocale();
  const { db, user, features } = await gameContext();
  const live = await windowsLive(db, user.id, features);
  const params = await searchParams;
  const qs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => typeof e[1] === 'string')).toString();
  return (
    <RouteWindow title={t('Класации')} icon="🏆" live={live} href={`/game/leaderboards${qs ? `?${qs}` : ''}`} size="xl" testId="leaderboards-window">
      {live && <Page searchParams={Promise.resolve(params)} />}
    </RouteWindow>
  );
}
