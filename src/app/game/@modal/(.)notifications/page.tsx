import { NotificationsView } from '../../notifications/NotificationsView';
import { RouteWindow } from '@/components/gameui/RouteWindow';
import { gameContext } from '@/server/game/context';
import { windowsLive } from '@/server/game/tutorial-flags';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

/** 1.2.3.6 „Нов облик“: from inside the game the notifications open as a game window over the page. */
export default async function NotificationsWindow() {
  await initLocale();
  const { db, user, features } = await gameContext();
  const live = await windowsLive(db, user.id, features);
  return (
    <RouteWindow title={t('Известия')} icon="🔔" live={live} href="/game/notifications" size="md" testId="notifications-window">
      {live && <NotificationsView inWindow />}
    </RouteWindow>
  );
}
