import { ShopView } from '../../shop/ShopView';
import { RouteWindow } from '@/components/gameui/RouteWindow';
import { gameContext } from '@/server/game/context';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

/** 1.2.3.6 „Нов облик“: from inside the game the shop opens as a game window over the page. */
export default async function ShopWindow() {
  await initLocale();
  const { features } = await gameContext();
  return (
    <RouteWindow title={t('Магазин')} icon="💎" live={!!features.game_ui} href="/game/shop" size="xl" testId="shop-store-window">
      <ShopView />
    </RouteWindow>
  );
}
