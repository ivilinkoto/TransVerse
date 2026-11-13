import Page from '../../first-week/page';
import { RouteWindow } from '@/components/gameui/RouteWindow';
import { gameContext } from '@/server/game/context';
import { windowsLive } from '@/server/game/tutorial-flags';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

/** 1.4 „Първите 7 дни“: from inside the game it opens as a game window. */
export default async function FirstWeekWindow() {
  await initLocale();
  const { db, user, features } = await gameContext();
  const live = await windowsLive(db, user.id, features);
  return (
    <RouteWindow title={t('Първите 7 дни')} icon="🌱" live={live} href="/game/first-week" size="md" testId="first-week-window">
      {live && <Page />}
    </RouteWindow>
  );
}
