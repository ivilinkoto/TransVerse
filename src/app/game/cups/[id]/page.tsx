import { notFound } from 'next/navigation';
import { Badge, Card, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { TextAction } from '@/components/ui/TextAction';
import { CARGO, type CargoType } from '@/lib/game/cargo';
import { CUP_METRIC_LABELS, cupPrizes, type CupMetric } from '@/lib/game/community-cups';
import { dateTime, dec, money } from '@/lib/format';
import { cupView } from '@/server/game/community-cups';
import { gameContext } from '@/server/game/context';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

/** v2.0: one community tournament — the ranking, joining and the organiser's tools. */
export default async function CupPage({ params }: { params: Promise<{ id: string }> }) {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.community_cups) notFound();
  const id = (await params).id;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const view = await cupView(db, id);
  if (!view) notFound();
  const { cup, organizer, ranking } = view;
  const mine = cup.organizerId === user.id;
  const joined = ranking.some((r) => r.userId === user.id);
  const open = cup.status === 'open' && cup.endsAt > now;
  const prizes = cupPrizes(cup.poolCents, Math.max(1, Math.min(3, ranking.length)));
  return (
    <div className="space-y-6">
      <PageHeader title={cup.name} subtitle={t('Организатор: {0} · {1} – {2}', organizer, dateTime(cup.startsAt), dateTime(cup.endsAt))} />
      <Card>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="gold">{money(cup.poolCents)}</Badge>
          <span>{tx(CUP_METRIC_LABELS[cup.metric as CupMetric])}</span>
          {cup.cargoType && <span>· {tx(CARGO[cup.cargoType as CargoType]?.label ?? cup.cargoType)}</span>}
          {cup.countryCode && <span>· {cup.countryCode}</span>}
          {cup.entryFeeCents > 0 && <span>· {t('такса {0}', money(cup.entryFeeCents))}</span>}
          <span className="text-mist-400">· {t('Награди: {0}', prizes.map(money).join(' / '))}</span>
        </div>
        {cup.description && <p className="mt-2 text-sm text-mist-300">{cup.description}</p>}
        {cup.announcement && <p className="mt-2 rounded-lg border border-gold-500/30 bg-gold-500/5 p-2 text-sm">📣 {cup.announcement}</p>}
        {open && !joined && !mine && <div className="mt-3"><ActionButton action={{ type: 'cupJoin', cupId: cup.id }} className="btn-primary" confirm={cup.entryFeeCents ? t('Влизаш в турнира срещу {0}?', money(cup.entryFeeCents)) : undefined}>{t('Включи се')}</ActionButton></div>}
        {cup.status === 'cancelled' && <p className="mt-2 text-sm text-loss">{t('Турнирът е отменен.')}</p>}
      </Card>
      <Card title={t('Класиране')}>
        <ol className="divide-y divide-asphalt-800 text-sm">
          {ranking.map((r, i) => (
            <li key={r.userId} className={`flex items-center justify-between gap-2 py-2 ${r.userId === user.id ? 'text-volt-400' : ''}`}>
              <span><span className="num mr-2 text-mist-400">{i + 1}.</span>{r.username}</span>
              <span className="flex items-center gap-2">
                <span className="num">{dec(r.score)}</span>
                {mine && cup.status === 'open' && <ActionButton action={{ type: 'cupRemove', cupId: cup.id, userId: r.userId }} className="btn-ghost text-loss py-1 text-xs" confirm={t('Да извадим ли {0} от турнира?', r.username)}>{t('Извади')}</ActionButton>}
              </span>
            </li>
          ))}
        </ol>
        {!ranking.length && <p className="text-sm text-mist-400">{t('Още няма участници.')}</p>}
      </Card>
      {mine && cup.status === 'open' && (
        <Card title={t('Инструменти на организатора')}>
          <div className="space-y-3">
            <TextAction label={t('Публикувай')} action={{ type: 'cupAnnounce', cupId: cup.id }} field="text" placeholder={t('Съобщение до всички играчи')} ariaLabel={t('Съобщение')} maxLength={400} />
            {cup.startsAt > now && <ActionButton action={{ type: 'cupCancel', cupId: cup.id }} className="btn-ghost text-loss" confirm={t('Да отменим ли турнира? Наградата и таксите се връщат.')}>{t('Отмени турнира')}</ActionButton>}
          </div>
        </Card>
      )}
    </div>
  );
}
