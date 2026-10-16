import { Award, BadgeCheck, Target, Building2, LifeBuoy, ClipboardList, Gauge, Landmark, Map, Settings, ShoppingCart, Truck, UserRound, Users, Warehouse, Wrench } from 'lucide-react';

export const NAV = [
  { href: '/game', label: 'Обзор', icon: Gauge },
  { href: '/game/map', label: 'Карта на света', icon: Map },
  { href: '/game/contracts', label: 'Транспортни поръчки', icon: ClipboardList },
  { href: '/game/fleet', label: 'Автопарк', icon: Truck },
  { href: '/game/garage', label: 'Гараж', icon: Wrench },
  { href: '/game/market', label: 'Пазар', icon: ShoppingCart },
  { href: '/game/licences', label: 'Лицензи', icon: BadgeCheck },
  { href: '/game/staff', label: 'Служители', icon: UserRound },
  { href: '/game/logistics', label: 'Логистика', icon: Warehouse },
  { href: '/game/company', label: 'Транспортна компания', icon: Building2 },
  { href: '/game/companies', label: 'Компании на играчите', icon: Users },
  { href: '/game/missions', label: 'Мисии', icon: Target },
] as const;

/** Account pages in the ☰ menu of the top bar. */
export const ACCOUNT_MENU = [
  { href: '/game/finance', label: 'Финанси', icon: Landmark },
  { href: '/game/progress', label: 'Прогрес и постижения', icon: Award },
  { href: '/game/profile', label: 'Профил и настройки', icon: Settings },
  { href: '/game/support', label: 'Поддръжка', icon: LifeBuoy },
] as const;

/** Sections that need the operator licence from founding a company (shown with a lock otherwise). */
export const COMPANY_ONLY = new Set(['/game/staff']);
