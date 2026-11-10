import Page from '../../skills/page';
import { RouteWindow } from '@/components/gameui/RouteWindow';
import { gameContext } from '@/server/game/context';
import { windowsLive } from '@/server/game/tutorial-flags';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

/** 1.3 „Умения на шофьора“: from inside the game the skills open as a game window. */
export default async function SkillsWindow() {
  await initLocale();
  const { db, user, features } = await gameContext();
  const live = await windowsLive(db, user.id, features);
  return (
    <RouteWindow title={t('Умения на шофьора')} icon="🌳" live={live} href="/game/skills" size="xl" testId="skills-window">
      {live && <Page />}
    </RouteWindow>
  );
}
