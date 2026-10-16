'use client';

import { Bell, LogOut, Menu, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client/api';
import { ACCOUNT_MENU } from './nav';

/** Bell with the unread count; the count is hidden while the notifications page is open (it marks them read). */
export function NotificationBell({ unread }: { unread: number }) {
  const pathname = usePathname();
  const active = pathname.startsWith('/game/notifications');
  const show = unread > 0 && !active;
  return (
    <Link
      href="/game/notifications"
      aria-label={show ? `Известия (${unread} нови)` : 'Известия'}
      title="Известия"
      aria-current={active ? 'page' : undefined}
      className={`relative flex h-9 w-9 items-center justify-center rounded-full border transition ${active ? 'border-cyan-glow/50 bg-volt-500/15 text-cyan-glow' : 'border-asphalt-700 text-mist-300 hover:bg-asphalt-800 hover:text-white'}`}
    >
      <Bell className="h-4 w-4" />
      {show && <span className="num absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full bg-amber-sig px-1 text-center text-[11px] font-bold leading-[18px] text-asphalt-950">{unread > 99 ? '99+' : unread}</span>}
    </Link>
  );
}

/** The ☰ account menu: finance, progress, profile, support, admin and logout. */
export function AccountMenu({ staff }: { staff: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const logout = async () => {
    await api('/api/auth/logout', {});
    router.replace('/');
    router.refresh();
  };

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Профил и още"
        title="Профил и още"
        className={`flex h-9 w-9 items-center justify-center rounded-full border transition ${open ? 'border-cyan-glow/50 bg-volt-500/15 text-white' : 'border-asphalt-700 text-mist-300 hover:bg-asphalt-800 hover:text-white'}`}
      >
        <Menu className="h-5 w-5" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-60 rounded-2xl border border-asphalt-700 bg-asphalt-900 p-1.5 shadow-2xl shadow-black/50">
          {ACCOUNT_MENU.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${active ? 'bg-volt-500/15 text-white' : 'text-mist-300 hover:bg-asphalt-800 hover:text-white'}`}
              >
                <item.icon className={`h-4 w-4 ${active ? 'text-cyan-glow' : ''}`} />
                {item.label}
              </Link>
            );
          })}
          {staff && (
            <Link href="/admin" role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-prestige hover:bg-prestige/10">
              <ShieldCheck className="h-4 w-4" /> Админ панел
            </Link>
          )}
          <div className="my-1 border-t border-asphalt-800" />
          <button type="button" role="menuitem" onClick={logout} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-mist-400 hover:bg-asphalt-800 hover:text-white">
            <LogOut className="h-4 w-4" /> Изход
          </button>
        </div>
      )}
    </div>
  );
}
