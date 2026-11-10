import Page from '../../dock/page';
import { RouteWindow } from '@/components/gameui/RouteWindow';
import { gameContext } from '@/server/game/context';
import { windowsLive } from '@/server/game/tutorial-flags';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

/** 1.3 „Нов облик“: from inside the game this section opens as a game window over the current page. */
export default async function DockWindow() {
  await initLocale();
  const { db, user, features } = await gameContext();
  const live = await windowsLive(db, user.id, features);
  return (
    <RouteWindow title={t('Рампата')} icon="🏗️" live={live} href="/game/dock" size="lg" testId="dock-window">
      {live && <Page />}
    </RouteWindow>
  );
}
