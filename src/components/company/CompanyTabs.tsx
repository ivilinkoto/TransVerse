'use client';

import { Settings2 } from 'lucide-react';
import Link from 'next/link';
import { useFeature } from '@/components/game/Features';
import type { FeatureId } from '@/lib/game/features';
import { usePathname } from 'next/navigation';

interface Tab {
  href: string;
  label: string;
  needs?: string;
  /** Shown once this feature is out (staff see it earlier). */
  feature?: FeatureId;
}

const TABS: Tab[] = [
  { href: '/game/company', label: 'Обзор' },
  { href: '/game/company/plot', label: 'Участък', feature: 'company_plot' },
  { href: '/game/company/chat', label: 'Чат' },
  { href: '/game/company/missions', label: 'Мисии' },
  { href: '/game/company/tenders', label: 'Търгове' },
  { href: '/game/company/members', label: 'Членове' },
  { href: '/game/company/development', label: 'Развитие' },
];

/** Less frequent pages, grouped under one "Управление" tab. */
const MANAGE: Tab[] = [
  { href: '/game/company/ranks', label: 'Длъжности' },
  { href: '/game/company/profile', label: 'Профил', needs: 'edit_profile' },
  { href: '/game/company/settings', label: 'Настройки', needs: 'manage_settings' },
];

export function CompanyTabs({ pending, allowed }: { pending: number; allowed: string[] }) {
  const pathname = usePathname();
  const plot = useFeature('company_plot');
  const tabs = TABS.filter((t) => !t.feature || (t.feature === 'company_plot' && plot));
  const manage = MANAGE.filter((t) => !t.needs || allowed.includes(t.needs));
  const inManage = manage.some((t) => pathname.startsWith(t.href));
  const isActive = (href: string) => (href === '/game/company' ? pathname === href : pathname.startsWith(href));
  const tab = (active: boolean) => `relative flex shrink-0 items-center gap-1.5 px-3 py-3 text-sm font-medium transition ${active ? 'text-white' : 'text-mist-400 hover:text-white'}`;
  return (
    <div>
      <nav className="-mx-4 flex overflow-x-auto border-b border-asphalt-800 px-4 [scrollbar-width:none] sm:mx-0 sm:px-0" aria-label="Раздели на компанията">
        {tabs.map((t) => {
          const active = isActive(t.href);
          return (
            <Link key={t.href} href={t.href} aria-current={active ? 'page' : undefined} className={tab(active)}>
              {t.label}
              {t.href === '/game/company/members' && pending > 0 && <span className="num rounded-full bg-amber-sig px-1.5 text-[11px] font-bold text-asphalt-950">{pending}</span>}
              {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-cyan-glow" aria-hidden="true" />}
            </Link>
          );
        })}
        <Link href={manage[0]!.href} aria-current={inManage ? 'page' : undefined} className={`${tab(inManage)} ml-auto`}>
          <Settings2 className="h-4 w-4" />Управление
          {inManage && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-cyan-glow" aria-hidden="true" />}
        </Link>
      </nav>
      {inManage && manage.length > 1 && (
        <div className="mt-3 flex gap-1.5">
          {manage.map((t) => (
            <Link key={t.href} href={t.href} aria-current={pathname.startsWith(t.href) ? 'page' : undefined} className={`rounded-full border px-3 py-1 text-xs font-medium transition ${pathname.startsWith(t.href) ? 'border-cyan-glow/50 bg-cyan-glow/10 text-cyan-glow' : 'border-asphalt-700 text-mist-400 hover:text-white'}`}>
              {t.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
