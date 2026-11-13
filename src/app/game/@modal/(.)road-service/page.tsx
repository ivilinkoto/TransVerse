import Page from '../../road-service/page';
import { RouteWindow } from '@/components/gameui/RouteWindow';
import { gameContext } from '@/server/game/context';
import { windowsLive } from '@/server/game/tutorial-flags';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

/** 1.4 „Пътна служба“: from inside the game the page opens as a game window. */
export default async function RoadServiceWindow() {
  await initLocale();
  const { db, user, features } = await gameContext();
  const live = await windowsLive(db, user.id, features);
  return (
    <RouteWindow title={t('Пътна служба')} icon="❄️" live={live} href="/game/road-service" testId="road-service-window">
      {live && <Page />}
    </RouteWindow>
  );
}
