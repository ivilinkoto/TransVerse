'use client';

import { Activity, ChevronDown, ClipboardList, Coins, CreditCard, Flag, Gauge, HeartPulse, LifeBuoy, LineChart, LogOut, Mail, Megaphone, Package, PartyPopper, Rocket, Route, Search, Siren, Stethoscope, Ticket, Users, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { adminGroupsFor, adminPageOf, type AdminIcon } from '@/lib/admin-nav';
import { t, tx } from '@/i18n/t';

const ICONS: Record<AdminIcon, LucideIcon> = {
  gauge: Gauge, search: Search, users: Users, health: Stethoscope, sources: Megaphone, retention: HeartPulse, journey: Route, tickets: LifeBuoy, reports: Flag, urgent: Siren,
  events: PartyPopper, payments: CreditCard, promo: Ticket, coins: Coins, items: Package, economy: LineChart, mail: Mail, system: Activity, readiness: Rocket, audit: ClipboardList,
};

/** 1.2.3.1: the admin menu in groups that fold, with „Отиди на…“ and the counters on the pages and their groups. */
export function AdminNav({ openTickets, openReports = 0, admin = true }: { openTickets: number; openReports?: number; admin?: boolean }) {
  const pathname = usePathname();
  const groups = adminGroupsFor(admin);
  const current = adminPageOf(pathname);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [mobile, setMobile] = useState(false);
  const badge = (href: string) => (href === '/admin/reports' ? openReports : href === '/admin/tickets' ? openTickets : 0);
  const query = q.trim().toLowerCase();

  const link = (p: (typeof groups)[number]['pages'][number]) => {
    const Icon = ICONS[p.icon];
    const active = current?.href === p.href;
    const n = badge(p.href);
    return (
      <Link key={p.href} href={p.href} onClick={() => { setQ(''); setMobile(false); }} className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-2 text-sm ${active ? 'bg-prestige/15 text-white' : 'text-mist-300 hover:bg-asphalt-800'}`}>
        <Icon className={`h-4 w-4 ${active ? 'text-prestige' : ''}`} />
        <span className="flex-1">{tx(p.label)}</span>
        {n > 0 && <span className={`num rounded-full px-1.5 text-[11px] font-bold ${p.href === '/admin/reports' ? 'bg-loss text-white' : 'bg-amber-sig text-asphalt-950'}`}>{n}</span>}
      </Link>
    );
  };

  return (
    <>
    <button type="button" onClick={() => setMobile((m) => !m)} aria-expanded={mobile} className="flex w-full items-center gap-2 rounded-xl border border-asphalt-700 px-3 py-2 text-sm lg:hidden" data-testid="admin-menu-toggle">
      <span className="flex-1 text-left">{t('☰ Меню')} · {tx(current?.label ?? 'Табло')}</span>
      <ChevronDown className={`h-4 w-4 transition ${mobile ? 'rotate-180' : ''}`} />
    </button>
    <nav className={`${mobile ? 'flex' : 'hidden'} mt-2 flex-col gap-1 lg:mt-0 lg:flex`} aria-label={t('Админ навигация')}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Отиди на…')} aria-label={t('Отиди на…')} className="mb-2 w-full rounded-xl border border-asphalt-700 bg-asphalt-900 px-3 py-2 text-sm" data-testid="admin-goto" />
      {query ? (
        groups.flatMap((g) => g.pages).filter((p) => tx(p.label).toLowerCase().includes(query) || p.label.toLowerCase().includes(query)).map(link)
      ) : (
        groups.map((g) => {
          const here = g.pages.some((p) => p.href === current?.href);
          const waiting = g.pages.reduce((s, p) => s + badge(p.href), 0);
          const expanded = open[g.id] ?? (here || g.id === 'home' || g.id === 'todo');
          if (g.pages.length === 1 || g.id === 'home') return <div key={g.id} className="flex flex-col gap-1">{g.pages.map(link)}</div>;
          return (
            <div key={g.id} className="flex flex-col gap-1" data-testid={`admin-group-${g.id}`}>
              <button type="button" onClick={() => setOpen((o) => ({ ...o, [g.id]: !expanded }))} aria-expanded={expanded} className="mt-2 flex items-center gap-2 px-3 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-mist-400 hover:text-white">
                <span className="flex-1">{tx(g.label)}</span>
                {!expanded && waiting > 0 && <span className="num rounded-full bg-amber-sig px-1.5 text-[10px] font-bold text-asphalt-950">{waiting}</span>}
                <ChevronDown className={`h-3.5 w-3.5 transition ${expanded ? 'rotate-180' : ''}`} />
              </button>
              {expanded && g.pages.map(link)}
            </div>
          );
        })
      )}
      <Link href="/game" className="mt-4 flex shrink-0 items-center gap-3 rounded-xl px-3 py-2 text-sm text-mist-400 hover:bg-asphalt-800"><LogOut className="h-4 w-4" />{t('Към играта')}</Link>
    </nav>
    </>
  );
}
