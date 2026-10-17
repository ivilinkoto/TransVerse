import { Building2, ClipboardList, Gem, LayoutDashboard, Landmark, LifeBuoy, Map, Settings, Trophy, Truck, UserPlus, UserRound, type LucideIcon } from 'lucide-react';

export interface NavTab {
  href: string;
  label: string;
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
  { key: 'map', href: '/game/map', label: 'Карта', icon: Map },
  { key: 'jobs', href: '/game/contracts', label: 'Поръчки', icon: ClipboardList },
  {
    key: 'fleet',
    href: '/game/fleet',
    label: 'Автопарк',
    icon: Truck,
    tabs: [
      { href: '/game/fleet', label: 'Моите превозни средства' },
      { href: '/game/garage', label: 'Сервиз' },
      { href: '/game/market', label: 'Пазар' },
      { href: '/game/staff', label: 'Шофьори' },
      { href: '/game/logistics', label: 'Депа' },
      { href: '/game/licences', label: 'Лицензи' },
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
    ],
  },
  {
    key: 'compete',
    href: '/game/missions',
    label: 'Състезание',
    icon: Trophy,
    tabs: [
      { href: '/game/missions', label: 'Мисии' },
      { href: '/game/events', label: 'Ивенти' },
      { href: '/game/leaderboards', label: 'Класации' },
      { href: '/game/seasons', label: 'Сезони' },
      { href: '/game/progress', label: 'Постижения' },
    ],
  },
];

/** Account pages in the avatar menu of the top bar. */
export const ACCOUNT_MENU = [
  { href: '/game/profile', label: 'Профил и приятели', icon: UserRound },
  { href: '/game/finance', label: 'Финанси', icon: Landmark },
  { href: '/game/shop', label: 'Магазин и VIP', icon: Gem },
  { href: '/game/invite', label: 'Покани приятел', icon: UserPlus },
  { href: '/game/settings', label: 'Настройки', icon: Settings },
  { href: '/game/support', label: 'Поддръжка', icon: LifeBuoy },
] as const;

const within = (pathname: string, href: string) => (href === '/game' ? pathname === '/game' : pathname === href || pathname.startsWith(href + '/'));

/** The tab of a section that matches the path (the longest match wins, so /game/company/chat stays on "Моята компания"). */
export function activeTab(section: NavSection, pathname: string): NavTab | undefined {
  return section.tabs?.filter((t) => within(pathname, t.href)).sort((a, b) => b.href.length - a.href.length)[0];
}

/** The section a path belongs to, if any. */
export function sectionFor(pathname: string): NavSection | undefined {
  return SECTIONS.find((s) => (s.tabs ? !!activeTab(s, pathname) : within(pathname, s.href)));
}
