'use client';

import { Bell, LogOut, ShieldCheck, Star } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client/api';
import { ACCOUNT_MENU } from './nav';
import { Avatar } from './Avatar';
import { PlayerName } from './PlayerName';

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

/** The avatar menu: level, reputation, account pages, admin and logout. */
export function AccountMenu({ staff, attention = 0, user, level, reputation }: { staff: boolean; attention?: number; user: { id: string; username: string; role: string; vip: boolean; avatarVersion: number }; level: { level: number; share: number; current: number; next: number }; reputation: number }) {
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

  const pct = Math.max(2, Math.round(level.share * 100));
  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => {
          // The menu and the chat share the right side: opening the menu folds the chat.
          if (!open) window.dispatchEvent(new Event('tv:chat-close'));
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={staff && attention > 0 ? `Профил и още (${attention} чакат в админ панела)` : 'Профил и още'}
        title={`Ниво ${level.level} · ${pct}%`}
        className="relative flex h-9 w-9 items-center justify-center rounded-full p-[2px] transition hover:brightness-125"
        style={{ background: `conic-gradient(var(--color-cyan-glow) ${pct}%, var(--color-asphalt-700) 0)` }}
      >
        <span className="flex h-full w-full overflow-hidden rounded-full bg-asphalt-900"><Avatar userId={user.id} username={user.username} version={user.avatarVersion} vip={user.vip} className="h-full w-full text-sm" /></span>
        <span className="num absolute -bottom-1 -right-1 min-w-[18px] rounded-full border border-asphalt-950 bg-volt-500 px-1 text-center text-[10px] font-bold leading-4 text-white">{level.level}</span>
        {staff && attention > 0 && <span className="absolute -left-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-asphalt-950 bg-loss" aria-hidden="true" />}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-72 rounded-2xl border border-asphalt-700 bg-asphalt-900 p-1.5 shadow-2xl shadow-black/50">
          <div className="rounded-xl bg-asphalt-850 p-3">
            <PlayerName name={user.username} role={user.role} vip={user.vip} className="font-semibold" />
            <div className="mt-2 flex items-center justify-between text-xs text-mist-400">
              <span>Ниво <span className="font-semibold text-white">{level.level}</span></span>
              <span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5 text-prestige" />Репутация <span className="num font-semibold text-white">{reputation.toFixed(1)}</span></span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-asphalt-700"><div className="h-full rounded-full bg-gradient-to-r from-cyan-glow to-volt-500" style={{ width: `${pct}%` }} /></div>
            <div className="num mt-1 text-[11px] text-mist-400">{pct}% до ниво {level.level + 1}</div>
          </div>
          <div className="mt-1.5">
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
                  <item.icon className={`h-4 w-4 ${item.href === '/game/shop' ? 'text-gold-400' : active ? 'text-cyan-glow' : ''}`} />
                  {item.label}
                </Link>
              );
            })}
            {staff && (
              <Link href="/admin" role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-prestige hover:bg-prestige/10">
                <ShieldCheck className="h-4 w-4" /> Админ панел
                {attention > 0 && <span className="num ml-auto rounded-full bg-loss px-1.5 text-[11px] font-bold leading-5 text-white" title="Чакащи въпроси към поддръжката и доклади">{attention}</span>}
              </Link>
            )}
          </div>
          <div className="my-1 border-t border-asphalt-800" />
          <button type="button" role="menuitem" onClick={logout} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-mist-400 hover:bg-asphalt-800 hover:text-white">
            <LogOut className="h-4 w-4" /> Изход
          </button>
        </div>
      )}
    </div>
  );
}
