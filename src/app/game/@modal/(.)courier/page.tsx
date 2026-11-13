import Page from '../../courier/page';
import { RouteWindow } from '@/components/gameui/RouteWindow';
import { gameContext } from '@/server/game/context';
import { windowsLive } from '@/server/game/tutorial-flags';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

/** 1.4 „Градски куриер“: from inside the game it opens as a game window. */
export default async function CourierWindow({ searchParams }: { searchParams: Promise<{ city?: string }> }) {
  await initLocale();
  const { db, user, features } = await gameContext();
  const live = await windowsLive(db, user.id, features);
  return (
    <RouteWindow title={t('Градски куриер')} icon="🚐" live={live} href="/game/courier" size="xl" testId="courier-window">
      {live && <Page searchParams={searchParams} />}
    </RouteWindow>
  );
}
