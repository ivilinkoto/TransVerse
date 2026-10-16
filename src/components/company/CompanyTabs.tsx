'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/game/company', label: 'Обзор' },
  { href: '/game/company/chat', label: 'Чат' },
  { href: '/game/company/members', label: 'Членове' },
  { href: '/game/company/ranks', label: 'Длъжности' },
  { href: '/game/company/development', label: 'Развитие' },
  { href: '/game/company/profile', label: 'Профил', needs: 'edit_profile' },
  { href: '/game/company/settings', label: 'Настройки', needs: 'manage_settings' },
] as { href: string; label: string; needs?: string }[];

export function CompanyTabs({ pending, allowed }: { pending: number; allowed: string[] }) {
  const pathname = usePathname();
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" aria-label="Раздели на компанията">
      {TABS.filter((t) => !t.needs || allowed.includes(t.needs)).map((t) => {
        const active = t.href === '/game/company' ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} aria-current={active ? 'page' : undefined} className={`${active ? 'btn-primary' : 'btn-ghost'} shrink-0 py-2 text-sm`}>
            {t.label}
            {t.href === '/game/company/members' && pending > 0 && <span className="num rounded-full bg-amber-sig px-1.5 text-[11px] font-bold text-asphalt-950">{pending}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
