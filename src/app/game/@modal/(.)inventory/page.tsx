import { InventoryView } from '../../inventory/InventoryView';
import { RouteWindow } from '@/components/gameui/RouteWindow';
import { gameContext } from '@/server/game/context';
import { windowsLive } from '@/server/game/tutorial-flags';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

/**
 * 1.2.3.6 „Нов облик“: from inside the game the inventory opens as a game window over
 * the page the player is on (a direct link still opens the full page).
 */
export default async function InventoryWindow() {
  await initLocale();
  const { db, user, features } = await gameContext();
  const live = await windowsLive(db, user.id, features);
  if (!features.inventory) return null;
  return (
    <RouteWindow title={t('Инвентар')} icon="🎒" live={live} href="/game/inventory" size="xl" testId="inventory-window">
      {live && <InventoryView />}
    </RouteWindow>
  );
}
