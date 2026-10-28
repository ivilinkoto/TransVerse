'use client';

import { useEffect, useState } from 'react';
import { t } from '@/i18n/t';

/**
 * 1.1.4: time left until `until` (ISO), as "още 12:34" or "още 1 ч 05 мин".
 * Rendered only in the browser (the clock there), so the server page stays the same.
 */
export function Countdown({ until, className }: { until: string; className?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- start the clock after mount
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (now === null) return null;
  const left = Math.max(0, Math.floor((new Date(until).getTime() - now) / 1000));
  if (left === 0) return <span className={className}>{t('(изтече)')}</span>;
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  const text = h > 0 ? t('още {0} ч {1} мин', h, String(m).padStart(2, '0')) : t('още {0}:{1}', m, String(s).padStart(2, '0'));
  return <span className={`num ${className ?? ''}`}>{text}</span>;
}
