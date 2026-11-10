import Page from '../../rewards/page';
import { RouteWindow } from '@/components/gameui/RouteWindow';
import { gameContext } from '@/server/game/context';
import { windowsLive } from '@/server/game/tutorial-flags';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

/** 1.3 „Нов облик“: from inside the game this page opens as a game window over the current one. */
export default async function RewardsWindow() {
  await initLocale();
  const { db, user, features } = await gameContext();
  const live = await windowsLive(db, user.id, features);
  return (
    <RouteWindow title={t('Награди')} icon="🎁" live={live} href="/game/rewards" size="xl" testId="rewards-window">
      {live && <Page />}
    </RouteWindow>
  );
}
