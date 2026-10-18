'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A horizontal row that also scrolls without a touch screen: the mouse wheel
 * moves it sideways, arrows appear when it overflows, and the active item
 * (marked with aria-current or aria-selected) is kept in view.
 */
export function ScrollStrip({ children, label, className = '', activeKey }: { children: ReactNode; label: string; className?: string; activeKey?: string }) {
  const ref = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // A vertical wheel turn scrolls the row sideways (passive: false, to keep the page still).
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('scroll', measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, [measure]);

  useEffect(() => {
    const active = ref.current?.querySelector<HTMLElement>('[aria-current="page"],[aria-selected="true"]');
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    measure();
  }, [activeKey, measure]);

  const step = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * Math.max(120, (ref.current.clientWidth ?? 0) * 0.7), behavior: 'smooth' });

  return (
    <div className="relative flex min-w-0 flex-1 items-center">
      {edges.left && (
        <button type="button" onClick={() => step(-1)} aria-label="Назад" className="absolute left-0 top-0 z-10 mb-2 flex h-[calc(100%-0.5rem)] items-center bg-gradient-to-r from-asphalt-900 via-asphalt-900/90 to-transparent pr-3 text-mist-300 hover:text-white">
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}
      <nav ref={ref} aria-label={label} className={`flex min-w-0 flex-1 gap-1 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}>
        {children}
      </nav>
      {edges.right && (
        <button type="button" onClick={() => step(1)} aria-label="Напред" className="absolute right-0 top-0 z-10 mb-2 flex h-[calc(100%-0.5rem)] items-center bg-gradient-to-l from-asphalt-900 via-asphalt-900/90 to-transparent pl-3 text-mist-300 hover:text-white">
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
