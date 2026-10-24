import type { FeatureId } from '@/lib/game/features';
import { BookOpen, Building2, ClipboardList, Gem, GraduationCap, LayoutDashboard, Landmark, LifeBuoy, Map, ScrollText, Settings, Trophy, Truck, UserPlus, UserRound, type LucideIcon } from 'lucide-react';

export interface NavTab {
  href: string;
  label: string;
  /** Shown only when the viewer has this release feature. */
  feature?: FeatureId;
  /** Shown only while this holiday's content runs. */
  holiday?: 'halloween' | 'christmas' | 'marta' | 'spring' | 'easter';
  /** v1.9: the group the tab belongs to in a long section (shown as a second row). */
  group?: string;
  /** v1.9: shown in the menu from this player level (the page itself stays open to everyone). */
  minLevel?: number;
}

export interface NavSection {
  key: 'home' | 'map' | 'jobs' | 'fleet' | 'company' | 'compete';
  href: string;
  label: string;
  icon: LucideIcon;
  /** Pages that belong to the section; shown as tabs at the top of each of them when there is more than one. */
  tabs?: NavTab[];
}

/**
 * The game's main navigation: six sections. Related pages live as tabs inside a section,
 * so the menu stays short on every screen size.
 */
export const SECTIONS: NavSection[] = [
  { key: 'home', href: '/game', label: 'Табло', icon: LayoutDashboard },
  {
    key: 'map',
    href: '/game/map',
    label: 'Карта',
    icon: Map,
    tabs: [
      { href: '/game/map', label: 'Карта' },
      { href: '/game/road', label: 'Пътят · CB', feature: 'cb_radio', minLevel: 2 },
    ],
  },
  {
    key: 'jobs',
    href: '/game/contracts',
    label: 'Поръчки',
    icon: ClipboardList,
    tabs: [
      { href: '/game/contracts', label: 'Поръчки' },
      { href: '/game/clients', label: 'Клиенти', minLevel: 3 },
      { href: '/game/auctions', label: 'Специални товари', minLevel: 4 },
      { href: '/game/trade', label: 'Търговия със стоки', minLevel: 5 },
      { href: '/game/convoys', label: 'Конвои', feature: 'convoy_lobby', minLevel: 2 },
      { href: '/game/underground', label: 'Сенки', feature: 'smuggling', minLevel: 10 },
    ],
  },
  {
    key: 'fleet',
    href: '/game/fleet',
    label: 'Автопарк',
    icon: Truck,
    tabs: [
      { href: '/game/fleet', label: 'Моите превозни средства', group: 'Камиони' },
      { href: '/game/trips', label: 'Бордови дневник', feature: 'trip_log', group: 'Камиони' },
      { href: '/game/analytics', label: 'Анализ', group: 'Камиони', minLevel: 3 },
      { href: '/game/garage', label: 'Сервиз', group: 'Сервиз и депа' },
      { href: '/game/market', label: 'Пазар', group: 'Камиони' },
      { href: '/game/trailer-hire', label: 'Ремаркета под наем', feature: 'trailer_hire', group: 'Камиони', minLevel: 6 },
      { href: '/game/plates', label: 'Редки номера', feature: 'plate_auction', group: 'Камиони', minLevel: 6 },
      { href: '/game/staff', label: 'Шофьори', group: 'Хора' },
      { href: '/game/logistics', label: 'Депа', group: 'Сервиз и депа', minLevel: 4 },
      { href: '/game/licences', label: 'Лицензи', group: 'Хора', minLevel: 2 },
    ],
  },
  {
    key: 'company',
    href: '/game/company',
    label: 'Компания',
    icon: Building2,
    tabs: [
      { href: '/game/company', label: 'Моята компания' },
      { href: '/game/companies', label: 'Всички компании' },
      { href: '/game/recruitment', label: 'Набиране', feature: 'recruitment_board', minLevel: 3 },
      { href: '/game/shares', label: 'Борса за акции', feature: 'share_market', minLevel: 6 },
    ],
  },
  {
    key: 'compete',
    href: '/game/missions',
    label: 'Състезание',
    icon: Trophy,
    tabs: [
      { href: '/game/halloween', label: 'Хелуин', holiday: 'halloween', group: 'Сезонни' },
      { href: '/game/christmas', label: 'Коледа', holiday: 'christmas', group: 'Сезонни' },
      { href: '/game/marta', label: 'Баба Марта', holiday: 'marta', feature: 'marta', group: 'Сезонни' },
      { href: '/game/spring', label: 'Първа пролет', holiday: 'spring', feature: 'spring', group: 'Сезонни' },
      { href: '/game/easter', label: 'Великден', holiday: 'easter', feature: 'easter', group: 'Сезонни' },
      { href: '/game/missions', label: 'Мисии', group: 'Днес' },
      { href: '/game/parking', label: 'Паркирай', feature: 'parking_game', group: 'Днес' },
      { href: '/game/league', label: 'Лига', group: 'Класации', minLevel: 2 },
      { href: '/game/duels', label: 'Дуели', feature: 'duels', group: 'Класации', minLevel: 3 },
      { href: '/game/rally', label: 'Рали', feature: 'rally', group: 'Класации', minLevel: 4 },
      { href: '/game/challenges', label: 'Предизвикателства', feature: 'weekly_challenge', group: 'Днес', minLevel: 3 },
      { href: '/game/cup', label: 'Пролетна купа', feature: 'spring_cup', group: 'Класации', minLevel: 5 },
      { href: '/game/predictions', label: 'Прогнози', feature: 'predictions', group: 'Общност', minLevel: 5 },
      { href: '/game/livery', label: 'Ливреи', feature: 'livery_contest', group: 'Общност', minLevel: 5 },
      { href: '/game/truck-contest', label: 'Камион на месеца', feature: 'truck_contest', group: 'Общност', minLevel: 5 },
      { href: '/game/pass', label: 'Пропуск', group: 'Днес', minLevel: 2 },
      { href: '/game/events', label: 'Ивенти', group: 'Днес' },
      { href: '/game/leaderboards', label: 'Класации', group: 'Класации' },
      { href: '/game/news', label: 'Седмичник', group: 'Общност' },
      { href: '/game/seasons', label: 'Сезони', group: 'Класации', minLevel: 2 },
      { href: '/game/progress', label: 'Постижения', group: 'Колекции' },
      { href: '/game/collection', label: 'Албум', feature: 'city_album', group: 'Колекции', minLevel: 2 },
      { href: '/game/postcards', label: 'Картички', feature: 'postcards', group: 'Колекции', minLevel: 2 },
      { href: '/game/my-map', label: 'Картата ми', feature: 'my_map', group: 'Колекции', minLevel: 3 },
    ],
  },
];

/** Account pages in the avatar menu of the top bar. */
export const ACCOUNT_MENU = [
  { href: '/game/profile', label: 'Профил и приятели', icon: UserRound },
  { href: '/game/finance', label: 'Финанси', icon: Landmark },
  { href: '/game/shop', label: 'Магазин и VIP', icon: Gem },
  { href: '/game/invite', label: 'Покани приятел', icon: UserPlus },
  { href: '/game/mentor', label: 'Наставник', icon: GraduationCap },
  { href: '/game/updates', label: 'Обновления', icon: ScrollText },
  { href: '/game/settings', label: 'Настройки', icon: Settings },
  { href: '/game/help', label: 'Помощ и правила', icon: BookOpen },
  { href: '/game/support', label: 'Поддръжка', icon: LifeBuoy },
] as const;

const within = (pathname: string, href: string) => (href === '/game' ? pathname === '/game' : pathname === href || pathname.startsWith(href + '/'));

/** The tabs to show: holiday tabs only during their holiday (and on their own page). */
export function visibleTabs(section: NavSection, holiday: string | null, pathname: string, has: (feature: FeatureId) => boolean = () => true, player: NavPlayer | null = null): NavTab[] {
  // Several holidays can overlap (Баба Марта and Първа пролет): `holiday` lists them comma-separated.
  return (section.tabs ?? []).filter(
    (t) =>
      (!t.holiday || (holiday ?? '').split(',').includes(t.holiday) || within(pathname, t.href)) &&
      (!t.feature || has(t.feature)) &&
      // v1.9: a newer player's menu grows with the level (the open page always shows).
      (!player || player.showAll || !t.minLevel || player.level >= t.minLevel || within(pathname, t.href)),
  );
}

/** v1.9: what the menu needs to know about the player (null = everything, as before). */
export interface NavPlayer {
  level: number;
  showAll: boolean;
}

/** v1.9: the groups of a section's visible tabs, in order (empty when the section has none). */
export function tabGroups(tabs: readonly NavTab[]): { name: string; tabs: NavTab[] }[] {
  const out: { name: string; tabs: NavTab[] }[] = [];
  for (const t of tabs) {
    if (!t.group) return [];
    const g = out.find((x) => x.name === t.group);
    if (g) g.tabs.push(t);
    else out.push({ name: t.group, tabs: [t] });
  }
  // Seasonal pages first only while they run; otherwise "Днес" leads.
  return out;
}

/** v1.9: tabs that unlock with the level — for the "Ново за теб" window. */
export function unlockTabs(): (NavTab & { section: string })[] {
  return SECTIONS.flatMap((s) => (s.tabs ?? []).filter((t) => t.minLevel).map((t) => ({ ...t, section: s.label })));
}

/** The tab of a section that matches the path (the longest match wins, so /game/company/chat stays on "Моята компания"). */
export function activeTab(section: NavSection, pathname: string): NavTab | undefined {
  return section.tabs?.filter((t) => within(pathname, t.href)).sort((a, b) => b.href.length - a.href.length)[0];
}

/** The section a path belongs to, if any. */
export function sectionFor(pathname: string): NavSection | undefined {
  return SECTIONS.find((s) => (s.tabs ? !!activeTab(s, pathname) : within(pathname, s.href)));
}
