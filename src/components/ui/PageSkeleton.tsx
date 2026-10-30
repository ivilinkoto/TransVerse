'use client';

import { t } from '@/i18n/t';

/** 1.1.3.5: shown at once while a page loads, so the player sees that something is coming. */
export function PageSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="space-y-6" role="status" aria-live="polite" aria-label={t('Зареждане…')}>
      <div className="space-y-2">
        <div className="h-8 w-56 max-w-full animate-pulse rounded-lg bg-asphalt-800" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded bg-asphalt-800/70" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-2xl border border-asphalt-800 bg-asphalt-900/60" style={{ animationDelay: `${i * 80}ms` }} />
        ))}
      </div>
      <span className="sr-only">{t('Зареждане…')}</span>
    </div>
  );
}
