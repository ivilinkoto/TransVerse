'use client';

import { Lock, LogOut, Menu, ShieldCheck, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Logo } from '@/components/brand/Logo';
import { api } from '@/lib/client/api';
import { COMPANY_ONLY, NAV } from './nav';

export function Sidebar({ unread, staff, independent }: { unread: number; staff: boolean; independent: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const logout = async () => {
    await api('/api/auth/logout', {});
    router.replace('/');
    router.refresh();
  };

  const links = (
    <nav className="flex flex-col gap-0.5" aria-label="Игрова навигация">
      {NAV.map((item) => {
        const active = item.href === '/game' ? pathname === '/game' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            onClick={() => setOpen(false)}
            className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${active ? 'bg-volt-500/15 text-white shadow-[inset_2px_0_0_0_var(--color-cyan-glow)]' : 'text-mist-300 hover:bg-asphalt-800 hover:text-white'}`}
          >
            <item.icon className={`h-4 w-4 ${active ? 'text-cyan-glow' : ''}`} />
            <span className="flex-1">{item.label}</span>
            {independent && COMPANY_ONLY.has(item.href) && <Lock className="h-3.5 w-3.5 text-mist-400" aria-label="Изисква компания" />}
            {item.href === '/game/notifications' && unread > 0 && <span className="num rounded-full bg-amber-sig px-1.5 text-[11px] font-bold text-asphalt-950">{unread}</span>}
          </Link>
        );
      })}
      {staff && (
        <Link href="/admin" className="mt-3 flex items-center gap-3 rounded-xl border border-prestige/40 px-3 py-2 text-sm text-prestige hover:bg-prestige/10">
          <ShieldCheck className="h-4 w-4" /> Админ панел
        </Link>
      )}
      <button onClick={logout} className="mt-3 flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-mist-400 hover:bg-asphalt-800 hover:text-white">
        <LogOut className="h-4 w-4" /> Изход
      </button>
    </nav>
  );

  return (
    <>
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-6 overflow-y-auto border-r border-asphalt-800 bg-asphalt-900/70 px-3 py-5 lg:flex">
        <div className="px-2">
          <Logo href="/game" />
        </div>
        {links}
      </aside>
      <div className="flex items-center justify-between border-b border-asphalt-800 bg-asphalt-900/80 px-4 py-3 lg:hidden">
        <Logo href="/game" />
        <button className="btn-ghost px-3" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Меню">
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open && <div className="border-b border-asphalt-800 bg-asphalt-900 px-3 py-3 lg:hidden">{links}</div>}
    </>
  );
}
