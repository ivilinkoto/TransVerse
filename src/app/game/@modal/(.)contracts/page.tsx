import { ContractsView, type ContractsParams } from '../../contracts/ContractsView';
import { RouteWindow } from '@/components/gameui/RouteWindow';
import { gameContext } from '@/server/game/context';
import { windowsLive } from '@/server/game/tutorial-flags';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

/**
 * 1.3 „Нов облик“: from inside the game the board opens as a game window over the page
 * the player is on. During the tutorial (its map step is on the page) and without the
 * new look the full page opens instead; a direct link always opens the page.
 */
export default async function ContractsWindow({ searchParams }: { searchParams: Promise<ContractsParams> }) {
  await initLocale();
  const { db, user, features } = await gameContext();
  const live = await windowsLive(db, user.id, features);
  const params = await searchParams;
  const qs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => typeof e[1] === 'string')).toString();
  return (
    <RouteWindow title={t('Курсове')} icon="📋" live={live} href={`/game/contracts${qs ? `?${qs}` : ''}`} size="xl" testId="contracts-window">
      {live && <ContractsView params={params} inWindow />}
    </RouteWindow>
  );
}
