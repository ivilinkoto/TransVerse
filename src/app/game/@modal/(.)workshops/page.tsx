import Page from '../../workshops/page';
import { RouteWindow } from '@/components/gameui/RouteWindow';
import { gameContext } from '@/server/game/context';
import { windowsLive } from '@/server/game/tutorial-flags';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

/** 1.3 „Собствен сервиз“: from inside the game the workshops open as a game window. */
export default async function WorkshopsWindow() {
  await initLocale();
  const { db, user, features } = await gameContext();
  const live = await windowsLive(db, user.id, features);
  return (
    <RouteWindow title={t('Сервизи на играчите')} icon="🔧" live={live} href="/game/workshops" size="lg" testId="workshops-window">
      {live && <Page />}
    </RouteWindow>
  );
}
