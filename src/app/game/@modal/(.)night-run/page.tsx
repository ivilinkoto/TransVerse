import Page from '../../night-run/page';
import { RouteWindow } from '@/components/gameui/RouteWindow';
import { gameContext } from '@/server/game/context';
import { windowsLive } from '@/server/game/tutorial-flags';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

/** 1.3 „Нощен рейс“: from inside the game the run opens as a game window. */
export default async function NightRunWindow() {
  await initLocale();
  const { db, user, features } = await gameContext();
  const live = await windowsLive(db, user.id, features);
  return (
    <RouteWindow title={t('Нощен рейс')} icon="🌙" live={live} href="/game/night-run" size="lg" testId="night-run-window">
      {live && <Page />}
    </RouteWindow>
  );
}
