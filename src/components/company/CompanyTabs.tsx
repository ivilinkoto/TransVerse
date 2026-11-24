'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useFeatures } from '@/components/game/Features';
import type { FeatureId } from '@/lib/game/features';
import { t as tr, tx } from '@/i18n/t';

interface Page {
  href: string;
  label: string;
  /** A rank permission the page needs (the owner has all). */
  needs?: string;
  /** Shown once this feature is out (staff see it earlier). */
  feature?: FeatureId;
}

interface Group {
  id: string;
  label: string;
  emoji: string;
  pages: Page[];
}

/**
 * 1.3.3 „Всичко на едно място“, етап 3: the company's pages in five groups —
 * always the same five tabs, and a second row with the pages of the open group
 * (before, the row showed only „Обзор“ and the page you were on).
 */
export const COMPANY_GROUPS: Group[] = [
  { id: 'overview', label: 'Преглед', emoji: '🏢', pages: [{ href: '/game/company', label: 'Обзор' }] },
  { id: 'people', label: 'Членове', emoji: '👥', pages: [{ href: '/game/company/members', label: 'Членове' }, { href: '/game/company/ranks', label: 'Длъжности' }] },
  {
    id: 'growth', label: 'Развитие', emoji: '📈',
    pages: [
      { href: '/game/company/development', label: 'Развитие' },
      { href: '/game/company/plot', label: 'Участък', feature: 'company_plot' },
      { href: '/game/company/factory', label: 'Фабрика', feature: 'factories' },
      { href: '/game/company/branches', label: 'Филиали', feature: 'branches' },
      { href: '/game/company/holding', label: 'Холдинг', feature: 'holdings' },
      { href: '/game/company/territories', label: 'Територии', feature: 'territories' },
      { href: '/game/company/tenders', label: 'Търгове' },
    ],
  },
  {
    id: 'together', label: 'Общност', emoji: '🤝',
    pages: [
      { href: '/game/company/missions', label: 'Мисии' },
      { href: '/game/company/community', label: 'Общност', feature: 'departments' },
      { href: '/game/company/alliance', label: 'Съюз', feature: 'alliances' },
      { href: '/game/company/museum', label: 'Музей', feature: 'museum' },
    ],
  },
  { id: 'manage', label: 'Управление', emoji: '⚙️', pages: [{ href: '/game/company/profile', label: 'Профил', needs: 'edit_profile' }, { href: '/game/company/settings', label: 'Настройки', needs: 'manage_settings' }] },
];

const within = (pathname: string, href: string) => (href === '/game/company' ? pathname === href : pathname === href || pathname.startsWith(href + '/'));

/** The group a company page belongs to (Обзор for anything else under /game/company). */
export const companyGroupOf = (pathname: string) => COMPANY_GROUPS.find((g) => g.pages.some((p) => within(pathname, p.href))) ?? COMPANY_GROUPS[0]!;

export function CompanyTabs({ pending, allowed }: { pending: number; allowed: string[] }) {
  const pathname = usePathname();
  const has = useFeatures();
  const visible = (p: Page) => (!p.feature || has(p.feature)) && (!p.needs || allowed.includes(p.needs));
  const groups = COMPANY_GROUPS.map((g) => ({ ...g, pages: g.pages.filter(visible) })).filter((g) => g.pages.length > 0);
  const open = groups.find((g) => g.id === companyGroupOf(pathname).id) ?? groups[0]!;
  const tab = (active: boolean) => `relative flex shrink-0 items-center gap-1.5 px-3 py-3 text-sm font-medium transition ${active ? 'text-white' : 'text-mist-400 hover:text-white'}`;
  return (
    <div>
      <nav className="-mx-4 flex overflow-x-auto border-b border-asphalt-800 px-4 [scrollbar-width:none] sm:mx-0 sm:px-0" aria-label={tr('Раздели на компанията')} data-testid="company-groups">
        {groups.map((g) => {
          const active = g.id === open.id;
          return (
            <Link key={g.id} href={g.pages[0]!.href} aria-current={active ? 'page' : undefined} className={tab(active)}>
              <span aria-hidden>{g.emoji}</span>{tx(g.label)}
              {g.id === 'people' && pending > 0 && <span className="num rounded-full bg-amber-sig px-1.5 text-[11px] font-bold text-asphalt-950">{pending}</span>}
              {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-cyan-glow" aria-hidden="true" />}
            </Link>
          );
        })}
      </nav>
      {open.pages.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-1.5" data-testid="company-group-pages">
          {open.pages.map((p) => (
            <Link key={p.href} href={p.href} aria-current={within(pathname, p.href) ? 'page' : undefined} className={`rounded-full border px-3 py-1 text-xs font-medium transition ${within(pathname, p.href) ? 'border-cyan-glow/50 bg-cyan-glow/10 text-cyan-glow' : 'border-asphalt-700 text-mist-400 hover:text-white'}`}>
              {tx(p.label)}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
