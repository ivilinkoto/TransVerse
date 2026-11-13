'use client';

import { useState, type ReactNode } from 'react';
import { ShopBuy, type VehicleOption } from './ShopBuy';
import { SHOP_COLOURS, SHOP_EMOJI } from '@/lib/game/shop-look';
import type { ShopItem } from '@/lib/game/shop';
import { playSelect } from '@/lib/client/motion';
import { t, tx } from '@/i18n/t';

type Tile = { item: ShopItem; was?: number; ribbon?: string };
type BuyProps = { balance: number; vip: boolean; vehicles: VehicleOption[]; cities: { id: number; name: string }[]; colors: string[]; vipColors: string[]; trailers: { id: string; label: string }[]; depots: { id: string; label: string }[] };

/** One product as a game card: a glowing picture, a ribbon, the price as a coin and the buy button. */
function ShopTile({ tile, buy }: { tile: Tile; buy: BuyProps }) {
  const { item } = tile;
  const colour = SHOP_COLOURS[item.category] ?? '#22d3ee';
  return (
    <li className="shop-tile flex flex-col rounded-3xl" style={{ '--tile': colour } as React.CSSProperties} data-testid="shop-tile">
      <div className="shop-tile-art relative flex h-28 items-center justify-center rounded-t-3xl">
        <span className="shop-tile-emoji text-6xl" aria-hidden>{SHOP_EMOJI[item.id] ?? '🛍️'}</span>
        {tile.ribbon && <span className="shop-ribbon">{tile.ribbon}</span>}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <p className="font-display text-base font-bold leading-tight text-white">{tx(item.label)}</p>
        <p className="line-clamp-2 text-xs text-mist-300">{tx(item.description)}</p>
        <p className="num mt-auto flex items-baseline gap-2 pt-1">
          {tile.was !== undefined && tile.was > item.price && <span className="text-xs text-mist-500 line-through">{tile.was} TC</span>}
          <span className="font-display text-lg font-bold" style={{ color: colour }}>🪙 {item.id === 'paint' && buy.vip ? 0 : item.price} TC</span>
        </p>
        <ShopBuy item={item} {...buy} compact />
      </div>
    </li>
  );
}

const TABS = [
  { id: 'featured', icon: '⭐', label: 'Препоръчано' },
  { id: 'vip', icon: '👑', label: 'VIP' },
  { id: 'boost', icon: '⚡', label: 'Бустери' },
  { id: 'service', icon: '🔧', label: 'Услуги' },
  { id: 'cosmetic', icon: '🎨', label: 'Козметика' },
  { id: 'account', icon: '👤', label: 'Профил' },
  { id: 'coins', icon: '💎', label: 'ТрансКоин' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/**
 * 1.2.3.6 „Нов облик“: the shop as a game store — a banner with the wallet and VIP,
 * tabs by kind, and every product as a game card that opens its purchase window.
 */
export function ShopStore({ coins, vip, vipUntil, friday, promo, tiles, buy, vipBenefits, extras, money, promoBox }: {
  coins: number;
  vip: boolean;
  vipUntil: string | null;
  /** Black Friday discount in %, 0 outside it. */
  friday: number;
  promo: boolean;
  tiles: Record<string, Tile[]>;
  buy: BuyProps;
  vipBenefits: { group: string; items: string[] }[];
  extras: ReactNode;
  money: ReactNode;
  promoBox: ReactNode;
}) {
  const featured = tiles.offers?.length ? tiles.offers : [...(tiles.vip ?? []).slice(0, 2), ...(tiles.boost ?? []).slice(0, 2)];
  const [tab, setTab] = useState<TabId>('featured');
  const list = tab === 'featured' ? featured : tiles[tab] ?? [];
  const pick = (id: TabId) => {
    playSelect();
    setTab(id);
  };
  return (
    <div className="space-y-4" data-testid="shop-store">
      <div className="shop-hero relative overflow-hidden rounded-3xl p-5">
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-gold-300">TransVerse</p>
            <h1 className="font-display text-2xl font-bold text-white sm:text-3xl">{t('Магазин')}</h1>
            <p className="mt-1 text-sm text-mist-300">{t('VIP, удобства и стил за твоята компания.')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="shop-wallet flex items-center gap-2 rounded-2xl px-4 py-2" data-testid="shop-wallet">
              <span className="text-2xl" aria-hidden>🪙</span>
              <span className="num font-display text-2xl font-bold text-white">{coins.toLocaleString()}</span>
              <span className="text-sm font-semibold text-cyan-glow">TC</span>
            </span>
            <button type="button" onClick={() => pick('coins')} className="game-action game-action-gold flex-row px-4 py-2.5 text-sm">💎 {t('Купи TC')}</button>
          </div>
        </div>
        <p className={`relative mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${vip ? 'bg-gold-400/15 text-gold-300' : 'bg-white/5 text-mist-300'}`}>👑 {vip && vipUntil ? t('VIP до {0}', vipUntil) : t('Нямаш VIP')}</p>
      </div>
      {friday > 0 && <div className="rounded-2xl border border-gold-400/50 bg-gradient-to-r from-black/70 to-gold-400/15 px-4 py-3 font-display font-bold text-gold-300" data-testid="black-friday">{t('🛍 Черен петък · −{0}%', friday)}</div>}
      <div className="shop-tabs -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label={t('Магазин')}>
        {TABS.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} onClick={() => pick(x.id)} className={`shop-tab flex shrink-0 items-center gap-1.5 rounded-2xl px-3.5 py-2 text-sm font-bold ${tab === x.id ? 'shop-tab-on' : ''}`}>
            <span aria-hidden>{x.icon}</span>{tx(x.label)}
          </button>
        ))}
      </div>
      {tab === 'vip' && (
        <div className="shop-vip rounded-3xl p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {vipBenefits.map((b, k) => (
              <div key={`${b.group}-${k}`}>
                <p className="mb-1 text-xs font-bold uppercase tracking-wider text-gold-300">{b.group}</p>
                <ul className="space-y-1 text-sm text-mist-100">{b.items.map((i, k) => <li key={`${i}-${k}`} className="flex gap-2"><span className="text-gold-400">✦</span>{i}</li>)}</ul>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">{extras}</div>
          <p className="mt-2 text-xs text-mist-400">{t('VIP не дава сезонни точки и не влияе на класациите — предимствата са умерени, за да е честно за всички.')}</p>
        </div>
      )}
      {tab === 'coins' ? (
        <div className="space-y-4">
          {promo && promoBox && <div className="shop-vip rounded-3xl p-4"><p className="mb-2 font-display font-bold text-white">{t('🎟 Имаш код?')}</p>{promoBox}</div>}
          {money}
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4" data-testid="shop-grid">
          {list.map((tile, k) => <ShopTile key={`${tab}-${tile.item.id}-${k}`} tile={tile} buy={buy} />)}
          {!list.length && <li className="col-span-full py-8 text-center text-sm text-mist-400">{t('Тук сега няма продукти.')}</li>}
        </ul>
      )}
    </div>
  );
}
