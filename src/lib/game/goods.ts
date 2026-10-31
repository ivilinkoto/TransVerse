import { CARGO, type CargoType } from './cargo';

/**
 * 1.1.4 (`more_goods`): more goods on the board, asked for by the players.
 * They ride on the existing cargo categories and bodies; some carry a trait
 * that makes them pay more (fragile, valuable, dangerous). Pure game data —
 * the trait is read back from the goods' name, so nothing new is stored.
 */
export const GOODS_TRAITS = {
  fragile: { label: 'Чупливо', emoji: '🥂', multiplier: 1.1 },
  valuable: { label: 'Ценно', emoji: '💎', multiplier: 1.2 },
  adr: { label: 'Опасен товар (ADR)', emoji: '☢️', multiplier: 1.15 },
} as const;
export type GoodsTrait = keyof typeof GOODS_TRAITS;

export const NEW_GOODS: Record<CargoType, { name: string; trait?: GoodsTrait }[]> = {
  pallets: [
    { name: 'Електроника', trait: 'valuable' },
    { name: 'Вино в бутилки', trait: 'fragile' },
    { name: 'Керамични плочки', trait: 'fragile' },
    { name: 'Санитарен фаянс', trait: 'fragile' },
    { name: 'Козметика' },
    { name: 'Играчки' },
    { name: 'Велосипеди' },
    { name: 'Спортни стоки' },
    { name: 'Хартия на рула' },
    { name: 'Кафе' },
    { name: 'Аерозоли', trait: 'adr' },
  ],
  refrigerated: [
    { name: 'Ваксини', trait: 'valuable' },
    { name: 'Яйца', trait: 'fragile' },
    { name: 'Сладолед' },
    { name: 'Шоколад' },
    { name: 'Риба и морски дарове' },
    { name: 'Сирена' },
    { name: 'Замразено тесто' },
  ],
  bulk: [
    { name: 'Царевица' },
    { name: 'Ечемик' },
    { name: 'Рапица' },
    { name: 'Варовик' },
    { name: 'Въглища' },
    { name: 'Железна руда' },
    { name: 'Дървесни пелети' },
  ],
  container: [
    { name: 'Контейнер с електроника', trait: 'valuable' },
    { name: 'Контейнер с химикали', trait: 'adr' },
    { name: 'Контейнер с дрехи' },
    { name: 'Контейнер с резервни части' },
    { name: 'Контейнер с мебели' },
  ],
  liquid: [
    { name: 'Бензин', trait: 'adr' },
    { name: 'Втечнен газ', trait: 'adr' },
    { name: 'Етанол', trait: 'adr' },
    { name: 'Битум', trait: 'adr' },
    { name: 'Вино на едро' },
    { name: 'Плодов концентрат' },
    { name: 'Течен шоколад' },
  ],
  special: [
    { name: 'Перка за вятърна турбина' },
    { name: 'Багер' },
    { name: 'Булдозер' },
    { name: 'Яхта', trait: 'valuable' },
    { name: 'Промишлен генератор' },
    { name: 'Мостова греда' },
  ],
  steel: [
    { name: 'Стоманени тръби' },
    { name: 'Алуминиеви профили' },
    { name: 'Медни катоди', trait: 'valuable' },
    { name: 'Бетонни елементи' },
    { name: 'Строително скеле' },
    { name: 'Листово стъкло', trait: 'fragile' },
  ],
  vehicles: [
    { name: 'Ретро автомобили', trait: 'valuable' },
    { name: 'Спортни автомобили', trait: 'valuable' },
    { name: 'Пикапи' },
    { name: 'Мотоциклети' },
    { name: 'Кемпери' },
    { name: 'Таксита за автопарк' },
  ],
};

const TRAIT_OF = new Map(Object.values(NEW_GOODS).flatMap((list) => list.flatMap((g) => (g.trait ? [[g.name, g.trait] as const] : []))));

/** The goods a contract of this cargo may carry (the new ones from 1.1.4 on). */
export function goodsFor(cargo: CargoType, more: boolean): string[] {
  return more ? [...CARGO[cargo].goods, ...NEW_GOODS[cargo].map((g) => g.name)] : CARGO[cargo].goods;
}

/** 1.1.4.1: the goods for loads whose pay is set elsewhere (tenders, urgent, clients…) — the new ones without a trait. */
export function plainGoodsFor(cargo: CargoType, more: boolean): string[] {
  return more ? [...CARGO[cargo].goods, ...NEW_GOODS[cargo].filter((g) => !g.trait).map((g) => g.name)] : CARGO[cargo].goods;
}

/** The trait of these goods, if any (by their Bulgarian name, as stored on the contract). */
export function goodsTrait(goods: string | null | undefined): GoodsTrait | null {
  return (goods && TRAIT_OF.get(goods)) || null;
}

/** How much more these goods pay (1 without a trait). */
export function goodsMultiplier(goods: string | null | undefined): number {
  const trait = goodsTrait(goods);
  return trait ? GOODS_TRAITS[trait].multiplier : 1;
}
