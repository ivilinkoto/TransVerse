import Page from '../../winter-games/page';
import { RouteWindow } from '@/components/gameui/RouteWindow';
import { gameContext } from '@/server/game/context';
import { windowsLive } from '@/server/game/tutorial-flags';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

/** 1.4 „Зимни игри на компаниите“: from inside the game it opens as a game window. */
export default async function WinterGamesWindow() {
  await initLocale();
  const { db, user, features } = await gameContext();
  const live = await windowsLive(db, user.id, features);
  return (
    <RouteWindow title={t('Зимни игри')} icon="🏅" live={live} href="/game/winter-games" size="lg" testId="winter-games-window">
      {live && <Page />}
    </RouteWindow>
  );
}
