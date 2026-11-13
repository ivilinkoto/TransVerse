/**
 * 1.4 „Първите 7 дни“: a path for a new player — one new step a day for the first week,
 * each a thing the game already counts (deliveries, the daily puzzle, a company, a second
 * truck, an arcade run, a level). A step opens on its day and stays open until the end of the
 * third week; its reward is claimed by hand. The whole path gives a badge and a gold case.
 */
import type { ItemId } from './items';

export type FirstWeekCheck = 'deliveries' | 'daily_route' | 'company' | 'fleet' | 'arcade' | 'level';
export interface FirstWeekStep { id: string; day: number; label: string; hint: string; href: string; check: FirstWeekCheck; target: number; cents: number; items?: { itemId: ItemId; qty: number }[] }

export const FIRST_WEEK_STEPS: FirstWeekStep[] = [
  { id: 'first-load', day: 1, label: 'Първата доставка', hint: 'Вземи товар от Курсове и го закарай.', href: '/game/contracts', check: 'deliveries', target: 1, cents: 1_500_00, items: [{ itemId: 'coffee', qty: 2 }] },
  { id: 'five-loads', day: 2, label: 'Пет доставки', hint: 'Пет товара общо — камионът не бива да стои.', href: '/game/contracts', check: 'deliveries', target: 5, cents: 3_000_00, items: [{ itemId: 'repair_kit', qty: 1 }] },
  { id: 'daily-route', day: 3, label: 'Пътят на деня', hint: 'Нареди градовете в най-краткия маршрут.', href: '/game/daily-route', check: 'daily_route', target: 1, cents: 2_000_00, items: [{ itemId: 'fuel_voucher', qty: 1 }] },
  { id: 'company', day: 4, label: 'Влез в компания', hint: 'Присъедини се към компания или основи своя.', href: '/game/companies', check: 'company', target: 1, cents: 3_000_00, items: [{ itemId: 'case_bronze', qty: 1 }] },
  { id: 'second-truck', day: 5, label: 'Втори камион', hint: 'Купи или наеми още един — два камиона печелят двойно.', href: '/game/market', check: 'fleet', target: 2, cents: 5_000_00 },
  { id: 'arcade', day: 6, label: 'Нощен рейс или Градски куриер', hint: 'Изиграй една от мини игрите.', href: '/game/night-run', check: 'arcade', target: 1, cents: 2_000_00, items: [{ itemId: 'energy_drink', qty: 1 }] },
  { id: 'level-4', day: 7, label: 'Ниво 4', hint: 'Курсовете и мисиите дават опит.', href: '/game/progress', check: 'level', target: 4, cents: 5_000_00, items: [{ itemId: 'case_silver', qty: 1 }] },
];

export const FIRST_WEEK = {
  /** The steps stay open this many days after the sign-up. */
  openDays: 21,
  badge: 'first-week',
  /** For the whole path. */
  final: { itemId: 'case_gold' as ItemId, qty: 1 },
} as const;

/** Days since the sign-up, counting the sign-up day as day 1. */
export const signupDay = (createdAt: Date, now: Date) => Math.floor((now.getTime() - createdAt.getTime()) / 86_400_000) + 1;
