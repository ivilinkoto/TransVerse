import { ArrowRight, PartyPopper } from 'lucide-react';
import Link from 'next/link';
import { Meter } from '@/components/ui';
import { duration } from '@/lib/format';
import { formatAmount, type EventMetric } from '@/lib/game/events';
import type { runningEvents } from '@/server/game/events';

/** Running global events on the overview, with the viewer's contribution. */
export function EventBanner({ events, now }: { events: Awaited<ReturnType<typeof runningEvents>>; now: Date }) {
  if (!events.length) return null;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {events.map(({ event: e, mine }) => {
        const metric = e.metric as EventMetric;
        const share = e.target ? Math.min(100, (e.progress / e.target) * 100) : 0;
        const left = e.endsAt.getTime() - now.getTime();
        return (
          <Link key={e.id} href="/game/events" className="panel group block border-gold-400/30 bg-gradient-to-r from-gold-400/10 via-transparent to-volt-500/10 p-4 transition hover:border-gold-400/60">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <PartyPopper className="h-5 w-5 shrink-0 text-gold-400" />
                <div className="min-w-0">
                  <div className="label">Ивент{e.completedAt ? ' · целта е постигната' : left > 0 ? ` · остават ${duration(left / 60_000)}` : ''}</div>
                  <div className="truncate font-display font-bold">{e.name}</div>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-mist-400 transition group-hover:translate-x-0.5 group-hover:text-white" />
            </div>
            <div className="mt-3 flex justify-between text-xs text-mist-400">
              <span className="num">{formatAmount(metric, e.progress)} / {formatAmount(metric, e.target)}</span>
              <span className="num">Твоят принос: <span className="font-semibold text-white">{formatAmount(metric, mine)}</span></span>
            </div>
            <Meter value={share} tone="gold" className="mt-1" />
          </Link>
        );
      })}
    </div>
  );
}
