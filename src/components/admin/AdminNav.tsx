'use client';

import { Activity, ClipboardList, CreditCard, Flag, Gauge, HeartPulse, LifeBuoy, LineChart, LogOut, Mail, PartyPopper, Search, Siren, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { t, tx } from '@/i18n/t';

const ITEMS = [
  { href: '/admin', label: 'Табло', icon: Gauge },
  { href: '/admin/search', label: 'Търсене', icon: Search },
  { href: '/admin/users', label: 'Потребители', icon: Users },
  { href: '/admin/retention', label: 'Задържане', icon: HeartPulse },
  { href: '/admin/tickets', label: 'Поддръжка', icon: LifeBuoy },
  { href: '/admin/reports', label: 'Доклади', icon: Flag },
  { href: '/admin/urgent', label: 'Спешни доставки', icon: Siren },
  { href: '/admin/events', label: 'Ивенти', icon: PartyPopper },
  { href: '/admin/payments', label: 'Плащания', icon: CreditCard },
  { href: '/admin/economy', label: 'Икономика', icon: LineChart },
  { href: '/admin/mail', label: 'Имейли', icon: Mail },
  { href: '/admin/system', label: 'Система и известия', icon: Activity },
  { href: '/admin/audit', label: 'Одит дневник', icon: ClipboardList },
];

export function AdminNav({ openTickets, openReports = 0 }: { openTickets: number; openReports?: number }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label={t('Админ навигация')}>
      {ITEMS.map((i) => {
        const active = i.href === '/admin' ? pathname === '/admin' : pathname.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-2 text-sm ${active ? 'bg-prestige/15 text-white' : 'text-mist-300 hover:bg-asphalt-800'}`}>
            <i.icon className={`h-4 w-4 ${active ? 'text-prestige' : ''}`} />
            <span className="flex-1">{tx(i.label)}</span>
            {i.href === '/admin/reports' && openReports > 0 && <span className="num rounded-full bg-loss px-1.5 text-[11px] font-bold text-white">{openReports}</span>}
            {i.href === '/admin/tickets' && openTickets > 0 && <span className="num rounded-full bg-amber-sig px-1.5 text-[11px] font-bold text-asphalt-950">{openTickets}</span>}
          </Link>
        );
      })}
      <Link href="/game" className="flex shrink-0 items-center gap-3 rounded-xl px-3 py-2 text-sm text-mist-400 hover:bg-asphalt-800 lg:mt-4"><LogOut className="h-4 w-4" />{t('Към играта')}</Link>
    </nav>
  );
}
