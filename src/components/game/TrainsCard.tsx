import Link from 'next/link';
import { Card } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { dateTime } from '@/lib/format';
import { LOCOS } from '@/lib/game/trains';
import type { Database } from '@/server/db/client';
import { trainsOf } from '@/server/game/trains';
import { place } from './TrainOrders';
import { t } from '@/i18n/t';

/** 1.3.3: the trains on the dashboard — where each is, when it arrives, and „Пусни пак“ for a free one. Nothing without trains. */
export async function TrainsCard({ db, userId, now }: { db: Database; userId: string; now: Date }) {
  const trains = (await trainsOf(db, userId)).filter((tr) => (tr.ownerId === userId && !tr.rental) || tr.run?.hirerId === userId || (tr.rental && tr.ownerId === userId && tr.run));
  if (!trains.length) return null;
  return (
    <Card title={t('Влаковете сега')} actions={<Link href="/game/trains" className="text-sm text-cyan-glow hover:underline">{t('Влакове →')}</Link>}>
      <ul className="space-y-2 text-sm" data-testid="trains-card">
        {trains.map((tr) => {
          const mine = tr.ownerId === userId && !tr.rental;
          const going = tr.run && new Date(tr.run.arriveAt) > now;
          return (
            <li key={tr.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-asphalt-700 bg-asphalt-850 px-3 py-2">
              <span className="min-w-0">
                <b>🚆 {LOCOS[tr.loco].name}</b>{!mine && <span className="text-xs text-mist-400"> · {tr.rental ? t('влак на играта') : t('нает от играч')}</span>}
                <span className="block text-xs text-mist-400">
                  {going ? t('Към {0} · пристига {1}', place(tr.run!.to), dateTime(tr.run!.arriveAt)) : t('На гара {0}', place(tr.run?.to ?? tr.at))}
                  {mine && tr.line?.on && ` · ${t('🔁 редовна линия')}`}
                </span>
              </span>
              {mine && !going && !tr.line?.on ? (
                <span className="flex items-center gap-2">
                  <ActionButton action={{ type: 'trainAgain', trainId: tr.id }} className="game-action game-action-gold flex-row px-3 py-1 text-xs">{t('🚆 Пусни пак')}</ActionButton>
                  <Link href={`/game/trains?train=${tr.id}`} className="text-xs text-cyan-glow hover:underline">{t('Поръчки →')}</Link>
                </span>
              ) : mine ? <Link href={`/game/trains?train=${tr.id}`} className="text-xs text-cyan-glow hover:underline">{t('Отвори →')}</Link> : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
