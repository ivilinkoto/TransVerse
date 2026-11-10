import Page from '../../buses/page';
import { RouteWindow } from '@/components/gameui/RouteWindow';
import { gameContext } from '@/server/game/context';
import { windowsLive } from '@/server/game/tutorial-flags';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

/** 1.3 „Автобусна компания“: from inside the game the bus lines open as a game window. */
export default async function BusesWindow() {
  await initLocale();
  const { db, user, features } = await gameContext();
  const live = await windowsLive(db, user.id, features);
  return (
    <RouteWindow title={t('Автобусна компания')} icon="🚌" live={live} href="/game/buses" size="xl" testId="buses-window">
      {live && <Page />}
    </RouteWindow>
  );
}
