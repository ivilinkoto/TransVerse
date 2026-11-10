import Page from '../../crisis/page';
import { RouteWindow } from '@/components/gameui/RouteWindow';
import { gameContext } from '@/server/game/context';
import { windowsLive } from '@/server/game/tutorial-flags';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

/** 1.3 „Световни кризи“: from inside the game the crisis opens as a game window. */
export default async function CrisisWindow() {
  await initLocale();
  const { db, user, features } = await gameContext();
  const live = await windowsLive(db, user.id, features);
  return (
    <RouteWindow title={t('Световни кризи')} icon="🌍" live={live} href="/game/crisis" size="lg" testId="crisis-window">
      {live && <Page />}
    </RouteWindow>
  );
}
