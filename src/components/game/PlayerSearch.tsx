'use client';

import { useFeature } from './Features';
import { Building2, Search, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client/api';
import type { SearchResult } from '@/server/game/search';
import { Avatar } from './Avatar';
import { openPlayerCard, PlayerName } from './PlayerName';

/** Opens the search from anywhere (e.g. the finance page hint). */
export function openPlayerSearch() {
  window.dispatchEvent(new CustomEvent('tv:search'));
}

/** Top-bar search: players by name, companies by name or tag. "/" or Ctrl+K opens it. */
/** The search in the top bar (a release feature). */
export function PlayerSearch() {
  return useFeature('search') ? <PlayerSearchBox /> : null;
}

function PlayerSearchBox() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const show = () => setOpen(true);
    const key = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName));
      if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('tv:search', show);
    document.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('tv:search', show);
      document.removeEventListener('keydown', key);
    };
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) return;
    let live = true;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await api<SearchResult>(`/api/players/search?q=${encodeURIComponent(text)}`);
        if (live) {
          setResult(r);
          setError(null);
        }
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        if (live) setBusy(false);
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  const close = () => setOpen(false);
  // Fewer than two letters: nothing is searched, older results are hidden.
  const short = q.trim().length < 2;
  const shown = short ? null : result;
  const empty = shown && !shown.players.length && !shown.companies.length;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex h-9 w-9 items-center justify-center rounded-full border border-asphalt-700 bg-asphalt-900/60 text-mist-300 transition hover:text-white" title="Търси играч или компания (/)" aria-label="Търси играч или компания">
        <Search className="h-4 w-4" />
      </button>
      {open && (
        <div className="fixed inset-0 z-[55] flex items-start justify-center px-3 pt-[calc(4.5rem+env(safe-area-inset-top))]" role="dialog" aria-modal="true" aria-label="Търсене на играчи">
          <button type="button" className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-label="Затвори" onClick={close} />
          <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-asphalt-700 bg-asphalt-900 shadow-2xl">
            <div className="flex items-center gap-2 border-b border-asphalt-800 px-3">
              <Search className="h-4 w-4 shrink-0 text-mist-400" />
              <input
                ref={input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Име на играч или компания…"
                aria-label="Име на играч или компания"
                maxLength={40}
                className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-mist-400"
              />
              <button type="button" onClick={close} className="rounded-full p-1.5 text-mist-400 hover:bg-asphalt-800 hover:text-white" aria-label="Затвори"><X className="h-4 w-4" /></button>
            </div>
            <div className="max-h-[60dvh] overflow-y-auto p-2">
              {short && <p className="px-2 py-4 text-sm text-mist-400">Напиши поне 2 букви от името.</p>}
              {busy && !shown && <p className="px-2 py-4 text-sm text-mist-400">Търсене…</p>}
              {!short && error && <p className="px-2 py-4 text-sm text-loss">{error}</p>}
              {empty && <p className="px-2 py-4 text-sm text-mist-400">Няма играч или компания с „{q.trim()}“.</p>}
              {shown && shown.players.length > 0 && (
                <>
                  <p className="label px-2 pb-1 pt-2">Играчи</p>
                  <ul>
                    {shown.players.map((p) => (
                      <li key={p.id}>
                        <button type="button" onClick={() => { close(); openPlayerCard(p.username); }} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-asphalt-800">
                          <span className="relative">
                            <Avatar userId={p.id} username={p.username} version={p.avatarVersion} vip={p.vip} className="h-9 w-9 text-sm" rounded="rounded-xl" />
                            <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-asphalt-900 ${p.online ? 'bg-profit' : 'bg-asphalt-500'}`} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <PlayerName name={p.username} role={p.role} vip={p.vip} card={false} className="font-semibold" />
                            <span className="block truncate text-xs text-mist-400">
                              ниво {p.level}
                              {p.companyName && <> · {p.companyTag && <span style={{ color: p.companyColor ?? undefined }}>[{p.companyTag}] </span>}{p.companyName}</>}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {shown && shown.companies.length > 0 && (
                <>
                  <p className="label px-2 pb-1 pt-3">Компании</p>
                  <ul>
                    {shown.companies.map((c) => (
                      <li key={c.id}>
                        <Link href={`/game/companies/${c.id}`} onClick={close} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-asphalt-800">
                          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-asphalt-800" style={{ color: c.color ?? undefined }}><Building2 className="h-4 w-4" /></span>
                          <span className="min-w-0">
                            <span className="block truncate font-semibold">{c.tag && <span style={{ color: c.color ?? undefined }}>[{c.tag}] </span>}{c.name}</span>
                            <span className="block text-xs text-mist-400">{c.members} {c.members === 1 ? 'член' : 'членове'}</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
