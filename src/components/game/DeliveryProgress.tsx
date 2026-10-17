'use client';

import { useEffect, useState } from 'react';
import { stateAt, type Segment } from '@/lib/game/schedule';
import { dateTime, duration } from '@/lib/format';

export const PHASE_LABEL: Record<string, string> = {
  drive: 'В движение',
  break: 'Почивка 45 мин',
  rest: 'Дневна почивка',
  border: 'Граничен контрол',
  loading: 'Товарене',
  unloading: 'Разтоварване',
  incident: 'Спрял по пътя',
};

/** Live progress computed from the server's schedule — no polling needed. */
export function DeliveryProgress({ schedule, etaAt, deadlineAt, compact = false }: { schedule: Segment[]; etaAt: string | Date; deadlineAt: string | Date; compact?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);
  const s = stateAt(schedule, now);
  const eta = new Date(etaAt).getTime();
  const late = eta > new Date(deadlineAt).getTime();
  const phase = s.done ? 'Пристигнал — уреждане…' : s.segment ? `${s.segment.note ?? PHASE_LABEL[s.segment.kind]}${s.segment.kind === 'drive' ? (s.leg === 'empty' ? ' · празен към товара' : ' · с товар') : ''}` : '';
  return (
    <div className="w-full">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className={s.segment?.kind === 'drive' ? 'text-cyan-glow' : 'text-amber-sig'}>{phase}</span>
        <span className="num text-mist-400">{s.done ? '' : `остават ${duration((eta - now) / 60_000)}`}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-asphalt-700">
        <div className="h-full rounded-full bg-gradient-to-r from-cyan-glow to-volt-500 transition-[width] duration-1000" style={{ width: `${Math.max(2, s.progress * 100)}%` }} />
      </div>
      {!compact && (
        <div className="mt-1 flex justify-between text-[11px] text-mist-400">
          <span>Пристигане: {dateTime(eta)}</span>
          <span className={late ? 'text-loss' : ''}>Срок: {dateTime(deadlineAt)}{late ? ' · очаква се закъснение' : ''}</span>
        </div>
      )}
    </div>
  );
}
