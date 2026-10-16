import { Award, Bell, Building2, CalendarClock, ClipboardList, Gauge, Landmark, Map, Medal, Settings, ShoppingCart, Truck, UserRound, Warehouse, Wrench } from 'lucide-react';

export const NAV = [
  { href: '/game', label: 'Обзор', icon: Gauge },
  { href: '/game/map', label: 'Карта на света', icon: Map },
  { href: '/game/contracts', label: 'Транспортни поръчки', icon: ClipboardList },
  { href: '/game/fleet', label: 'Автопарк', icon: Truck },
  { href: '/game/garage', label: 'Гараж', icon: Wrench },
  { href: '/game/market', label: 'Пазар', icon: ShoppingCart },
  { href: '/game/staff', label: 'Служители', icon: UserRound },
  { href: '/game/logistics', label: 'Логистика', icon: Warehouse },
  { href: '/game/company', label: 'Транспортна компания', icon: Building2 },
  { href: '/game/finance', label: 'Финанси', icon: Landmark },
  { href: '/game/progress', label: 'Прогрес и постижения', icon: Award },
  { href: '/game/seasons', label: 'Сезони', icon: CalendarClock },
  { href: '/game/leaderboards', label: 'Класации', icon: Medal },
  { href: '/game/notifications', label: 'Известия', icon: Bell },
  { href: '/game/profile', label: 'Профил и настройки', icon: Settings },
] as const;
