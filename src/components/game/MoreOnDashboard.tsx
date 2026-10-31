import { t } from '@/i18n/t';

/**
 * 1.1.4.1: what is good to know but not urgent on the dashboard (news, tips,
 * goals, past events) — folded under one line in the simple look, as before otherwise.
 */
export function MoreOnDashboard({ lean, title, children }: { lean: boolean; title?: string; children: React.ReactNode }) {
  if (!lean) return <>{children}</>;
  return (
    <details className="panel group p-3.5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-mist-200 marker:hidden">
        {title ?? t('Още на таблото')}
        <span className="text-mist-400 transition group-open:rotate-180" aria-hidden="true">▾</span>
      </summary>
      <div className="mt-3 space-y-4">{children}</div>
    </details>
  );
}
