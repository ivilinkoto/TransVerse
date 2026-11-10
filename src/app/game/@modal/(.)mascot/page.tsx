import Page from '../../mascot/page';
import { RouteWindow } from '@/components/gameui/RouteWindow';
import { gameContext } from '@/server/game/context';
import { windowsLive } from '@/server/game/tutorial-flags';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

/** 1.3 „Талисман в кабината“: from inside the game the mascot opens as a game window. */
export default async function MascotWindow() {
  await initLocale();
  const { db, user, features } = await gameContext();
  const live = await windowsLive(db, user.id, features);
  return (
    <RouteWindow title={t('Талисман')} icon="🐾" live={live} href="/game/mascot" size="lg" testId="mascot-window">
      {live && <Page />}
    </RouteWindow>
  );
}
