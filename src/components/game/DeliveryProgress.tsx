'use client';

import { useEffect, useState } from 'react';
import { stateAt, type Segment } from '@/lib/game/schedule';
import { dateTime, duration } from '@/lib/format';
import { ghostLead } from '@/lib/game/deals';
import { t, tx } from '@/i18n/t';

export const PHASE_LABEL: Record<string, string> = {
  drive: 'В движение',
  break: 'Почивка 45 мин',
  rest: 'Дневна почивка',
  border: 'Граничен контрол',
  loading: 'Товарене',
  unloading: 'Разтоварване',
  incident: 'Спрял по пътя',
  ferry: 'На ферибот',
  rail: 'На влак',
  charge: 'Зарежда батерията',
};

/** Live progress computed from the server's schedule — no polling needed. */
export function DeliveryProgress({ schedule, etaAt, deadlineAt, compact = false, ghost = null }: { schedule: Segment[]; etaAt: string | Date; deadlineAt: string | Date; compact?: boolean; ghost?: { username: string; minutes: number; mine: boolean } | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);
  const s = stateAt(schedule, now);
  const eta = new Date(etaAt).getTime();
  const late = eta > new Date(deadlineAt).getTime();
  const phase = s.done ? t('Пристигнал — уреждане…') : s.segment ? `${s.segment.note ? tx(s.segment.note) : tx(PHASE_LABEL[s.segment.kind] ?? '')}${s.segment.kind === 'drive' ? (s.leg === 'empty' ? t(' · празен към товара') : t(' · с товар')) : ''}` : '';
  return (
    <div className="w-full">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className={s.segment?.kind === 'drive' ? 'text-cyan-glow' : 'text-amber-sig'}>{phase}</span>
        <span className="num text-mist-400">{s.done ? '' : t('остават {0}', duration((eta - now) / 60_000))}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-asphalt-700">
        <div className="h-full rounded-full bg-gradient-to-r from-cyan-glow to-volt-500 transition-[width] duration-1000" style={{ width: `${Math.max(2, s.progress * 100)}%` }} />
      </div>
      {ghost && !s.done && (() => {
        // v1.8: the record run on this lane, started when this trip's loaded leg starts.
        const loaded = schedule.filter((x) => x.leg === 'loaded' && x.kind !== 'loading');
        if (!loaded.length) return null;
        const start = loaded[0]!.start;
        const lead = ghostLead(start, loaded.at(-1)!.end, ghost.minutes);
        const ghostShare = Math.min(1, Math.max(0, (now - start) / (ghost.minutes * 60_000)));
        const total = loaded.at(-1)!.toKm - loaded[0]!.fromKm;
        const mine = now < start ? 0 : Math.min(1, Math.max(0, total > 0 ? (s.km - loaded[0]!.fromKm) / total : 0));
        return (
          <div className="mt-2 rounded-lg bg-asphalt-800/70 px-2 py-1.5 text-[11px]">
            <div className="flex justify-between gap-2"><span>{t('👻 Призракът на {0} · {1}', ghost.mine ? t('твоя рекорд') : ghost.username, duration(ghost.minutes))}</span><span className={lead >= 0 ? 'text-profit' : 'text-loss'}>{lead >= 0 ? t('{0} напред', duration(lead)) : t('{0} назад', duration(-lead))}</span></div>
            <div className="relative mt-1 h-1.5 rounded-full bg-asphalt-700">
              <div className="absolute inset-y-0 left-0 rounded-full bg-cyan-glow/70" style={{ width: `${mine * 100}%` }} />
              <div className="absolute -top-1 h-3.5 w-1 rounded bg-white/80" style={{ left: `calc(${ghostShare * 100}% - 2px)` }} title={t('Призракът')} />
            </div>
          </div>
        );
      })()}
      {!compact && (
        <div className="mt-1 flex justify-between text-[11px] text-mist-400">
          <span>{t('Пристигане: {0}', dateTime(eta))}</span>
          <span className={late ? 'text-loss' : ''}>{t('Срок: {0}{1}', dateTime(deadlineAt), late ? t(' · очаква се закъснение') : '')}</span>
        </div>
      )}
    </div>
  );
}
