'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { motionEnabled, playWindowClose, playWindowOpen } from '@/lib/client/motion';
import { t } from '@/i18n/t';

/**
 * 1.2.3.6 „Нов облик“: the game window — a framed panel that opens over the game
 * with a short scale-in, a sound and a dimmed, blurred backdrop. Esc, the ✕ or a
 * click outside closes it (after a short closing animation). Windows can stack:
 * a later one opens above an earlier one, and Esc closes only the top one.
 */
export function GameWindow({
  title,
  icon,
  onClose,
  children,
  size = 'lg',
  accent = '#f6c343',
  footer,
  testId,
}: {
  title: ReactNode;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** sm: a card; md/lg: most windows; xl: a whole screen (the inventory). */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** The frame's colour (e.g. the rarity of an item). */
  accent?: string;
  footer?: ReactNode;
  testId?: string;
}) {
  const [closing, setClosing] = useState(false);
  const shell = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const closingRef = useRef(false);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    playWindowClose();
    if (!motionEnabled()) return onCloseRef.current();
    setClosing(true);
    setTimeout(() => onCloseRef.current(), 160);
  };
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    playWindowOpen();
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const all = document.querySelectorAll('[data-game-window]');
      if (all[all.length - 1] === shell.current) closeRef.current();
    };
    window.addEventListener('keydown', key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', key);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);
  const width = { sm: 'sm:max-w-md', md: 'sm:max-w-2xl', lg: 'sm:max-w-4xl', xl: 'sm:max-w-6xl' }[size];
  return createPortal(
    <div ref={shell} data-game-window className={`gw-backdrop fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4 ${closing ? 'gw-out' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        data-testid={testId}
        className={`gw-panel relative flex max-h-[92dvh] w-full ${width} flex-col overflow-hidden rounded-t-3xl outline-none sm:rounded-3xl`}
        style={{ '--gw-accent': accent } as React.CSSProperties}
      >
        <span aria-hidden className="gw-corner gw-corner-tl" />
        <span aria-hidden className="gw-corner gw-corner-tr" />
        <header className="gw-head flex items-center gap-3 px-4 py-3 sm:px-5">
          {icon && <span className="gw-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg">{icon}</span>}
          <h2 className="min-w-0 flex-1 truncate font-display text-lg font-bold tracking-wide text-white">{title}</h2>
          <button type="button" onClick={close} className="gw-close flex h-9 w-9 items-center justify-center rounded-xl" aria-label={t('Затвори')} data-testid="game-window-close">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="gw-body min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-3 sm:px-5">{children}</div>
        {footer && <footer className="gw-foot px-4 py-3 sm:px-5">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
