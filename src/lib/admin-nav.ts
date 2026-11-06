/**
 * 1.2.3.1: the admin menu in groups. `admin: true` pages are for administrators
 * only (support staff do not see them and are sent back to the dashboard).
 */
export type AdminIcon = 'gauge' | 'search' | 'users' | 'health' | 'sources' | 'retention' | 'journey' | 'tickets' | 'reports' | 'urgent' | 'events' | 'payments' | 'promo' | 'coins' | 'items' | 'economy' | 'mail' | 'system' | 'readiness' | 'audit' | 'partners';

export interface AdminPage { href: string; label: string; icon: AdminIcon; admin?: boolean }
export interface AdminGroup { id: string; label: string; pages: AdminPage[] }

export const ADMIN_GROUPS: AdminGroup[] = [
  { id: 'home', label: 'Табло', pages: [{ href: '/admin', label: 'Табло', icon: 'gauge' }, { href: '/admin/search', label: 'Търсене', icon: 'search' }] },
  { id: 'todo', label: 'Чака действие', pages: [{ href: '/admin/tickets', label: 'Поддръжка', icon: 'tickets' }, { href: '/admin/reports', label: 'Доклади', icon: 'reports' }, { href: '/admin/urgent', label: 'Спешни доставки', icon: 'urgent' }] },
  {
    id: 'players',
    label: 'Играчи',
    pages: [
      { href: '/admin/users', label: 'Потребители', icon: 'users' },
      { href: '/admin/sources', label: 'Откъде идват играчите', icon: 'sources', admin: true },
      { href: '/admin/retention', label: 'Задържане', icon: 'retention', admin: true },
      { href: '/admin/journey', label: 'Пътят на играча', icon: 'journey', admin: true },
    ],
  },
  {
    id: 'game',
    label: 'Игра',
    pages: [
      { href: '/admin/health', label: 'Здраве на играта', icon: 'health', admin: true },
      { href: '/admin/economy', label: 'Икономика', icon: 'economy', admin: true },
      { href: '/admin/events', label: 'Ивенти', icon: 'events' },
      { href: '/admin/items', label: 'Предмети и кейсове', icon: 'items', admin: true },
    ],
  },
  {
    id: 'money',
    label: 'Пари',
    pages: [
      { href: '/admin/payments', label: 'Плащания', icon: 'payments' },
      { href: '/admin/coins', label: 'Движение на ТрансКоин', icon: 'coins', admin: true },
      { href: '/admin/promo', label: 'Промокодове', icon: 'promo', admin: true },
      { href: '/admin/partners', label: 'Партньори', icon: 'partners', admin: true },
    ],
  },
  {
    id: 'system',
    label: 'Система',
    pages: [
      { href: '/admin/mail', label: 'Имейли', icon: 'mail', admin: true },
      { href: '/admin/system', label: 'Система и известия', icon: 'system', admin: true },
      { href: '/admin/readiness', label: 'Готовност за пускане', icon: 'readiness', admin: true },
      { href: '/admin/audit', label: 'Одит дневник', icon: 'audit', admin: true },
    ],
  },
];

/** The groups a staff member sees (support: without the administrators' pages). */
export function adminGroupsFor(admin: boolean): AdminGroup[] {
  return ADMIN_GROUPS.map((g) => ({ ...g, pages: g.pages.filter((p) => admin || !p.admin) })).filter((g) => g.pages.length);
}

/** The page a path belongs to (the longest matching href; '/admin' only for itself). */
export function adminPageOf(pathname: string): AdminPage | undefined {
  const all = ADMIN_GROUPS.flatMap((g) => g.pages);
  return all.filter((p) => (p.href === '/admin' ? pathname === '/admin' : pathname === p.href || pathname.startsWith(`${p.href}/`))).sort((a, b) => b.href.length - a.href.length)[0];
}

/** Is this path for administrators only? */
export const adminOnlyPath = (pathname: string) => !!adminPageOf(pathname)?.admin;
