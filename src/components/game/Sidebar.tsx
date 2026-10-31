'use client';

import { useFeature, useFeatures, useNavPlayer } from './Features';
import { Gem, LogOut, MessagesSquare, MoreHorizontal, ShieldCheck, ThumbsUp, X } from 'lucide-react';
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher';
import { DISCORD_URL, FACEBOOK_URL } from '@/lib/community';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Logo, LogoMark } from '@/components/brand/Logo';
import { api } from '@/lib/client/api';
import { ACCOUNT_MENU, SECTIONS, activeTab, coreTabs, sectionFor, tabGroups, visibleTabs, type NavSection, type NavTab } from './nav';
import { t as tr, tx } from '@/i18n/t';

export interface NavBadges {
  /** Mission rewards waiting to be claimed. */
  missions: number;
  /** A global event is running. */
  eventLive: boolean;
}

function SectionBadge({ section, badges, compact = false }: { section: NavSection; badges: NavBadges; compact?: boolean }) {
  if (section.key !== 'compete') return null;
  if (badges.missions > 0)
    return compact ? <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-gold-400" aria-label={tr('{0} награди', badges.missions)} /> : <span className="num rounded-full bg-gold-400 px-1.5 text-[11px] font-bold text-asphalt-950" title={tr('Награди за взимане')}>{tx(badges.missions)}</span>;
  if (badges.eventLive)
    return compact ? <span className="absolute right-1 top-1 h-2 w-2 animate-pulse rounded-full bg-cyan-glow" aria-label={tr('Тече ивент')} /> : <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-glow" title={tr('Тече ивент')} />;
  return null;
}

/** Desktop navigation: an icon rail on small laptops, a full sidebar from xl up. */
export function Sidebar({ badges, version, staff = false, holiday = null, attention = 0 }: { badges: NavBadges; version: string; staff?: boolean; holiday?: string | null; attention?: number }) {
  const pathname = usePathname();
  const current = sectionFor(pathname);
  // 1.1.4.1: four sections in the rail, the rest in "Още".
  const simple = useFeature('simple_ui');
  const [more, setMore] = useState(false);
  const sections = simple ? SECTIONS.filter((s) => MAIN_KEYS.includes(s.key)) : SECTIONS;
  const inMore = simple && !!current && !MAIN_KEYS.includes(current.key);
  return (
    <aside className="sticky top-0 hidden h-dvh w-[84px] shrink-0 flex-col border-r border-asphalt-800/80 bg-asphalt-900/60 px-3 py-5 backdrop-blur lg:flex xl:w-60">
      <div className="mb-8 flex justify-center xl:justify-start xl:px-2">
        <span className="xl:hidden"><Link href="/game" aria-label={tr('TransVerse — табло')}><LogoMark className="h-9 w-9" /></Link></span>
        <span className="hidden xl:block"><Logo href="/game" /></span>
      </div>
      <nav className="flex flex-col gap-1" aria-label={tr('Игрова навигация')}>
        {sections.map((s) => {
          const active = current?.key === s.key && !more;
          return (
            <Link
              key={s.key}
              href={s.href}
              title={tx(s.label)}
              aria-current={active ? 'page' : undefined}
              className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition max-xl:flex-col max-xl:gap-1 max-xl:px-1 max-xl:text-[10px] ${active ? 'bg-gradient-to-r from-volt-500/25 to-volt-500/5 text-white' : 'text-mist-300 hover:bg-asphalt-800/80 hover:text-white'}`}
            >
              {active && <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-cyan-glow max-xl:-left-3" aria-hidden="true" />}
              <s.icon className={`h-5 w-5 shrink-0 ${active ? 'text-cyan-glow' : 'text-mist-400 group-hover:text-mist-100'}`} />
              <span className="flex-1 max-xl:leading-none">{tx(s.label)}</span>
              <span className="max-xl:hidden"><SectionBadge section={s} badges={badges} /></span>
              <span className="xl:hidden"><SectionBadge section={s} badges={badges} compact /></span>
            </Link>
          );
        })}
        {simple && (
          <button type="button" onClick={() => { if (!more) window.dispatchEvent(new Event('tv:chat-close')); setMore((o) => !o); }} aria-expanded={more} title={tr('Още')} className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition max-xl:flex-col max-xl:gap-1 max-xl:px-1 max-xl:text-[10px] ${more || inMore ? 'bg-gradient-to-r from-volt-500/25 to-volt-500/5 text-white' : 'text-mist-300 hover:bg-asphalt-800/80 hover:text-white'}`}>
            {more ? <X className="h-5 w-5 shrink-0 text-cyan-glow" /> : <MoreHorizontal className={`h-5 w-5 shrink-0 ${inMore ? 'text-cyan-glow' : 'text-mist-400'}`} />}
            <span className="flex-1 text-left max-xl:leading-none">{tr('Още')}</span>
            {(badges.missions > 0 || badges.eventLive || (staff && attention > 0)) && !more && <span className={`h-2 w-2 rounded-full ${staff && attention > 0 ? 'bg-loss' : 'bg-gold-400'} max-xl:absolute max-xl:right-1 max-xl:top-1`} aria-hidden="true" />}
          </button>
        )}
      </nav>
      {more && <MoreSheet badges={badges} staff={staff} holiday={holiday} attention={attention} onClose={() => setMore(false)} desktop />}
      <div className="mt-auto">
        <Link href="/game/shop" title={tr('Магазин и VIP')} className="flex items-center gap-3 rounded-2xl border border-gold-400/30 bg-gradient-to-br from-gold-400/15 to-transparent p-3 text-gold-400 transition hover:border-gold-400/60 max-xl:justify-center">
          <Gem className="h-5 w-5 shrink-0" />
          <span className="max-xl:sr-only">
            <span className="block text-sm font-semibold">{tr('Магазин и VIP')}</span>
            <span className="block text-xs text-mist-400">{tr('ТрансКоин, бонуси, стил')}</span>
          </span>
        </Link>
        <Link href="/game/updates" className="mt-2 block text-center text-[11px] text-mist-500 transition hover:text-cyan-glow" title={tr('Обновления')}>v{version}</Link>
      </div>
    </aside>
  );
}

/** Tabs for the pages of the current section (e.g. Автопарк → Сервиз, Пазар, Шофьори…). */
export function SectionTabs({ holiday = null }: { holiday?: string | null }) {
  const pathname = usePathname();
  const has = useFeatures();
  const player = useNavPlayer();
  const simple = useFeature('simple_nav');
  const lean = useFeature('simple_ui');
  const [all, setAll] = useState(false);
  const box = useRef<HTMLElement>(null);
  const section = sectionFor(pathname);
  const tab = section ? activeTab(section, pathname) : undefined;
  // Keep the open tab in view when the row scrolls sideways on a phone.
  useEffect(() => {
    box.current?.querySelector('[aria-current=page]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [tab?.href]);
  if (!section?.tabs) return null;
  const tabs = visibleTabs(section, holiday, pathname, has, player);
  // 1.1.4.1: only the few main pages in the row; the others behind "Още ▾".
  if (lean) {
    const core = coreTabs(tabs, pathname);
    const rest = tabs.filter((t) => !core.includes(t));
    if (tabs.length < 2) return null;
    return (
      <nav ref={box} aria-label={tx(section.label)} className="-mx-4 mb-5 px-4 sm:mx-0 sm:px-0">
        <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
          <div className="inline-flex min-w-max gap-1 rounded-2xl border border-asphalt-800 bg-asphalt-900/70 p-1">
            {core.map((t) => {
              const active = t.href === tab?.href;
              return (
                <Link key={t.href} href={t.href} aria-current={active ? 'page' : undefined} className={`rounded-xl px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition sm:px-3.5 sm:py-2 sm:text-sm ${active ? 'bg-asphalt-700 text-white shadow-sm' : 'text-mist-400 hover:text-white'}`}>
                  {tx(t.label)}
                </Link>
              );
            })}
            {rest.length > 0 && (
              <button type="button" onClick={() => setAll((o) => !o)} aria-expanded={all} className={`rounded-xl px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition sm:px-3.5 sm:py-2 sm:text-sm ${all ? 'bg-asphalt-700 text-white' : 'text-mist-400 hover:text-white'}`}>
                {tr('Още ({0})', rest.length)} {all ? '▴' : '▾'}
              </button>
            )}
          </div>
        </div>
        {all && rest.length > 0 && (
          <div className="mt-2 rounded-2xl border border-asphalt-800 bg-asphalt-900/80 p-3">
            {(tabGroups(rest).length > 1 ? tabGroups(rest) : [{ name: '', tabs: rest }]).map((g) => (
              <div key={g.name} className="mb-2 last:mb-0">
                {g.name && <p className="mb-1 text-[11px] font-semibold text-mist-400">{tx(g.name)}</p>}
                <div className="flex flex-wrap gap-1.5">
                  {g.tabs.map((t) => (
                    <Link key={t.href} href={t.href} onClick={() => setAll(false)} className="rounded-lg border border-asphalt-700 px-2.5 py-1 text-[13px] text-mist-200 transition hover:border-cyan-glow/50 hover:text-white">
                      {tx(t.label)}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </nav>
    );
  }
  // v1.9: long sections show their groups first, then the group's pages.
  const groups = simple ? tabGroups(tabs) : [];
  const group = groups.find((g) => g.tabs.some((t) => t.href === tab?.href)) ?? groups[0];
  const shown: NavTab[] = group ? group.tabs : tabs;
  if (shown.length < 2 && groups.length < 2) return null;
  return (
    <nav ref={box} aria-label={tx(section.label)} className="-mx-4 mb-5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
      {groups.length > 1 && (
        <div className="mb-2 flex min-w-max gap-1.5">
          {groups.map((g) => (
            <Link key={g.name} href={g.tabs[0]!.href} aria-current={g === group ? 'true' : undefined} className={`rounded-full border px-3 py-1 text-xs font-semibold whitespace-nowrap transition ${g === group ? 'border-cyan-glow/60 bg-cyan-glow/10 text-cyan-glow' : 'border-asphalt-700 text-mist-400 hover:text-white'}`}>
              {tx(g.name)}
            </Link>
          ))}
        </div>
      )}
      <div className="inline-flex min-w-max gap-1 rounded-2xl border border-asphalt-800 bg-asphalt-900/70 p-1">
        {shown.map((t) => {
          const active = t.href === tab?.href;
          return (
            <Link key={t.href} href={t.href} aria-current={active ? 'page' : undefined} className={`rounded-xl px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition sm:px-3.5 sm:py-2 sm:text-sm ${active ? 'bg-asphalt-700 text-white shadow-sm' : 'text-mist-400 hover:text-white'}`}>
              {tx(t.label)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Phone and tablet navigation: a bottom bar with the four main sections and "Още" for everything else. */
export function MobileNav({ badges, staff, holiday = null, attention = 0 }: { badges: NavBadges; staff: boolean; holiday?: string | null; attention?: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const current = sectionFor(pathname);
  const main = SECTIONS.filter((s) => MAIN_KEYS.includes(s.key));
  const inMore = !current || !main.some((s) => s.key === current.key);

  return (
    <>
      <nav aria-label={tr('Основна навигация')} className="fixed inset-x-0 bottom-0 z-40 border-t border-asphalt-800 bg-asphalt-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <div className="mx-auto grid max-w-xl grid-cols-5">
          {main.map((s) => {
            const active = current?.key === s.key && !open;
            return (
              <Link key={s.key} href={s.href} aria-current={active ? 'page' : undefined} className={`relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${active ? 'text-cyan-glow' : 'text-mist-400'}`}>
                {active && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-cyan-glow" aria-hidden="true" />}
                <s.icon className="h-5 w-5" />
                {tx(s.label)}
              </Link>
            );
          })}
          <button type="button" onClick={() => { if (!open) window.dispatchEvent(new Event('tv:chat-close')); setOpen((o) => !o); }} aria-expanded={open} aria-label={tr('Още')} className={`relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${open || inMore ? 'text-cyan-glow' : 'text-mist-400'}`}>
            {(badges.missions > 0 || badges.eventLive) && !open && attention === 0 && <span className="absolute right-[calc(50%-14px)] top-2 h-2 w-2 rounded-full bg-gold-400" aria-hidden="true" />}
            {staff && attention > 0 && !open && <span className="absolute right-[calc(50%-14px)] top-2 h-2.5 w-2.5 rounded-full bg-loss" aria-hidden="true" />}
            {open ? <X className="h-5 w-5" /> : <MoreHorizontal className="h-5 w-5" />}
            {tr('Още')}
          </button>
        </div>
      </nav>

      {open && <MoreSheet badges={badges} staff={staff} holiday={holiday} attention={attention} onClose={() => setOpen(false)} />}
    </>
  );
}

/** 1.1.4.1: the four sections used most; everything else is in "Още" (phone and desktop alike). */
const MAIN_KEYS: NavSection['key'][] = ['home', 'jobs', 'fleet', 'map'];

/** "Още": the other sections as tiles by group, the account pages, Discord and logout. */
function MoreSheet({ badges, staff, holiday, attention, onClose, desktop = false }: { badges: NavBadges; staff: boolean; holiday: string | null; attention: number; onClose: () => void; desktop?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const mentor = useFeature('mentor');
  const has = useFeatures();
  const player = useNavPlayer();
  const simple = useFeature('simple_nav');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);
  const logout = async () => {
    await api('/api/auth/logout', {});
    router.replace('/');
    router.refresh();
  };
  const tile = 'flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-asphalt-700 bg-asphalt-850 px-2 py-3 text-center text-xs font-medium text-mist-100 transition hover:border-asphalt-500 active:scale-95';
  // 1.1.4.2: drawn at the end of <body>. Inside the sidebar (backdrop-blur makes it the containing
  // block of fixed children) the sheet stayed in the sidebar's box, under the page — on tablets the
  // tiles showed only between the dashboard's cards.
  return createPortal(
        <div className={`fixed inset-0 ${desktop ? 'z-50' : 'z-30 lg:hidden'}`} role="dialog" aria-modal="true" aria-label={tr('Още раздели')}>
          <button type="button" className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-label={tr('Затвори')} onClick={onClose} />
          <div className={desktop ? 'absolute left-[84px] top-0 h-dvh w-[min(560px,calc(100vw-84px))] overflow-y-auto border-r border-asphalt-700 bg-asphalt-900 px-5 py-5 shadow-2xl xl:left-60' : 'absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl border-t border-asphalt-700 bg-asphalt-900 px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-3 shadow-2xl'}>
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-asphalt-600" aria-hidden="true" />
            {SECTIONS.filter((s) => !MAIN_KEYS.includes(s.key)).map((s) => (
              <section key={s.key} className="mb-5">
                <h2 className="label mb-2 flex items-center gap-2"><s.icon className="h-3.5 w-3.5" />{tx(s.label)}</h2>
                {(simple && tabGroups(visibleTabs(s, holiday, pathname, has, player)).length > 1 ? tabGroups(visibleTabs(s, holiday, pathname, has, player)) : [{ name: '', tabs: visibleTabs(s, holiday, pathname, has, player) }]).map((g) => (
                <div key={g.name} className="mb-2">
                {g.name && <p className="mb-1 text-[11px] font-semibold text-mist-400">{tx(g.name)}</p>}
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {g.tabs.map((t) => (
                    <Link key={t.href} href={t.href} onClick={onClose} className={`${tile} ${activeTab(s, pathname)?.href === t.href ? 'border-cyan-glow/50 text-cyan-glow' : ''}`}>
                      {tx(t.label)}
                      {t.href === '/game/missions' && badges.missions > 0 && <span className="num rounded-full bg-gold-400 px-1.5 text-[10px] font-bold text-asphalt-950">{tr('{0} награди', badges.missions)}</span>}
                      {t.href === '/game/events' && badges.eventLive && <span className="rounded-full bg-cyan-glow/20 px-1.5 text-[10px] font-bold text-cyan-glow">{tr('тече сега')}</span>}
                    </Link>
                  ))}
                </div>
                </div>
                ))}
              </section>
            ))}
            <section>
              <h2 className="label mb-2 flex items-center justify-between gap-2">{tr('Профил')}<span className="sm:hidden"><LanguageSwitcher /></span></h2>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {ACCOUNT_MENU.filter((item) => mentor || item.href !== '/game/mentor').map((item) => (
                  <Link key={item.href} href={item.href} onClick={onClose} className={`${tile} ${pathname.startsWith(item.href) ? 'border-cyan-glow/50 text-cyan-glow' : ''}`}>
                    <item.icon className={`h-5 w-5 ${item.href === '/game/shop' ? 'text-gold-400' : 'text-mist-400'}`} />
                    {tx(item.label)}
                  </Link>
                ))}
                <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" onClick={onClose} className={tile}><MessagesSquare className="h-5 w-5 text-mist-400" />Discord</a>
                <a href={FACEBOOK_URL} target="_blank" rel="noopener noreferrer" onClick={onClose} className={tile}><ThumbsUp className="h-5 w-5 text-mist-400" />Facebook</a>
                {staff && (
                  <Link href="/admin" onClick={onClose} className={`${tile} relative text-prestige`}><ShieldCheck className="h-5 w-5" />{tr('Админ панел')}{attention > 0 && <span className="num absolute right-1.5 top-1.5 rounded-full bg-loss px-1.5 text-[11px] font-bold leading-5 text-white">{attention}</span>}</Link>
                )}
                <button type="button" onClick={logout} className={`${tile} text-mist-400`}><LogOut className="h-5 w-5" />{tr('Изход')}</button>
              </div>
            </section>
          </div>
        </div>,
    document.body,
  );
}
