import { NotificationsView } from '../../notifications/NotificationsView';
import { RouteWindow } from '@/components/gameui/RouteWindow';
import { gameContext } from '@/server/game/context';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

/** 1.2.3.6 „Нов облик“: from inside the game the notifications open as a game window over the page. */
export default async function NotificationsWindow() {
  await initLocale();
  const { features } = await gameContext();
  return (
    <RouteWindow title={t('Известия')} icon="🔔" live={!!features.game_ui} href="/game/notifications" size="md" testId="notifications-window">
      <NotificationsView inWindow />
    </RouteWindow>
  );
}
