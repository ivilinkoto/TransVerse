import { featureDate } from './features';

/** 1.2.2: for two weeks after the new menu goes out a player may keep the old one (Настройки → Меню). */
export const OLD_MENU_DAYS = 14;

/** Can the old menu still be chosen at `now`? */
export function oldMenuOffered(now: Date): boolean {
  const at = featureDate('nav_v2');
  return !!at && now.getTime() < at.getTime() + OLD_MENU_DAYS * 86_400_000;
}
