import Page from '../../daily-route/page';
import { RouteWindow } from '@/components/gameui/RouteWindow';
import { gameContext } from '@/server/game/context';
import { windowsLive } from '@/server/game/tutorial-flags';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

/** 1.3 „Пътят на деня“: from inside the game the puzzle opens as a game window. */
export default async function DailyRouteWindow() {
  await initLocale();
  const { db, user, features } = await gameContext();
  const live = await windowsLive(db, user.id, features);
  return (
    <RouteWindow title={t('Пътят на деня')} icon="🧭" live={live} href="/game/daily-route" size="lg" testId="daily-route-window">
      {live && <Page />}
    </RouteWindow>
  );
}
