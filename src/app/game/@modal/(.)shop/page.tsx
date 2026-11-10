import { ShopView } from '../../shop/ShopView';
import { RouteWindow } from '@/components/gameui/RouteWindow';
import { gameContext } from '@/server/game/context';
import { windowsLive } from '@/server/game/tutorial-flags';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

/** 1.2.3.6 „Нов облик“: from inside the game the shop opens as a game window over the page. */
export default async function ShopWindow() {
  await initLocale();
  const { db, user, features } = await gameContext();
  const live = await windowsLive(db, user.id, features);
  return (
    <RouteWindow title={t('Магазин')} icon="💎" live={live} href="/game/shop" size="xl" testId="shop-store-window">
      <ShopView />
    </RouteWindow>
  );
}
