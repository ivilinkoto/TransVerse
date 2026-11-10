'use client';

import { useEffect, useState } from 'react';
import { t } from '@/i18n/t';

/** 1.3: days, hours, minutes and seconds to an update, as four game tiles. */
export function ReleaseCountdown({ until }: { until: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- start the clock after mount
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = now === null ? null : Math.max(0, Math.floor((new Date(until).getTime() - now) / 1000));
  const parts = left === null ? null : [Math.floor(left / 86_400), Math.floor((left % 86_400) / 3600), Math.floor((left % 3600) / 60), left % 60];
  const labels = [t('дни'), t('часа'), t('минути'), t('секунди')];
  return (
    <div className="flex gap-2 sm:gap-3" role="timer" aria-live="off">
      {labels.map((label, i) => (
        <div key={label} className="countdown-tile flex w-16 flex-col items-center rounded-2xl py-2 sm:w-20 sm:py-3">
          <span className="num font-display text-2xl font-bold text-white sm:text-3xl">{parts ? String(parts[i]).padStart(2, '0') : '––'}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-mist-400">{label}</span>
        </div>
      ))}
    </div>
  );
}
