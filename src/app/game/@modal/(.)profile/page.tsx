import Page from '../../profile/page';
import { RouteWindow } from '@/components/gameui/RouteWindow';
import { gameContext } from '@/server/game/context';
import { windowsLive } from '@/server/game/tutorial-flags';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

/** 1.3 „Нов облик“: from inside the game this section opens as a game window over the current page. */
export default async function ProfileWindow() {
  await initLocale();
  const { db, user, features } = await gameContext();
  const live = await windowsLive(db, user.id, features);
  return (
    <RouteWindow title={t('Профил')} icon="👤" live={live} href="/game/profile" size="xl" testId="profile-window">
      {live && <Page />}
    </RouteWindow>
  );
}
