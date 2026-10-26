'use client';

import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import type { Release } from '@/lib/game/releases';
import { ReleaseBody, ReleaseTitle } from './ReleaseNotes';
import { t } from '@/i18n/t';

/**
 * 1.1.2: one release on the updates pages, folded: the title and the tagline,
 * and the full notes open on a tap. A link to `#v<version>` opens that one.
 */
export function ReleaseFold({ release, heading, className, children }: { release: Release; heading: 'h2' | 'h3'; className: string; children?: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const open = () => {
      if (ref.current && window.location.hash === `#v${release.version}`) {
        ref.current.open = true;
        ref.current.scrollIntoView({ block: 'start' });
      }
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, [release.version]);
  return (
    <details ref={ref} id={`v${release.version}`} className={`group scroll-mt-6 ${className}`}>
      <summary className="flex cursor-pointer list-none items-start gap-3 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1">
          {children}
          <ReleaseTitle release={release} as={heading} />
        </div>
        <span className="mt-1 inline-flex shrink-0 items-center gap-1 rounded-full border border-asphalt-700 px-3 py-1 text-xs text-mist-300 group-open:text-white">
          <span className="group-open:hidden">{t('Виж')}</span>
          <span className="hidden group-open:inline">{t('Скрий')}</span>
          <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
        </span>
      </summary>
      <div className="mt-5"><ReleaseBody release={release} /></div>
    </details>
  );
}
