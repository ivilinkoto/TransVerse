import { CalendarClock, CheckCircle2, Crown, Gift, PartyPopper, Trophy, Users, XCircle } from 'lucide-react';
import { PlayerName } from '@/components/game/PlayerName';
import { Badge, Meter } from '@/components/ui';
import { dateTime, duration, int } from '@/lib/format';
import { eventStatus, formatAmount, goalText, rewardFor, rewardText, type EventMetric, type EventRewards } from '@/lib/game/events';
import { isVip } from '@/lib/game/vip';
import type { EventDetail } from '@/server/game/events';
import { t, tx } from '@/i18n/t';

const PLACE_TONE = ['text-gold-400', 'text-mist-200', 'text-amber-sig'];

export function EventStatusBadge({ detail, now }: { detail: EventDetail; now: Date }) {
  const s = eventStatus(detail.event, now);
  if (s === 'scheduled') return <Badge tone="cyan">{t('започва след {0}', duration((detail.event.startsAt.getTime() - now.getTime()) / 60_000))}</Badge>;
  if (s === 'active') return <Badge tone="green">{t('тече · остават {0}', duration((detail.event.endsAt.getTime() - now.getTime()) / 60_000))}</Badge>;
  if (s === 'ending') return <Badge tone="gold">{detail.event.completedAt ? t('целта е постигната · раздаване на наградите') : t('приключва · раздаване на наградите')}</Badge>;
  if (s === 'success') return <Badge tone="green">{t('успешен')}</Badge>;
  if (s === 'failed') return <Badge tone="red">{t('целта не е постигната')}</Badge>;
  return <Badge>{t('отменен')}</Badge>;
}

export function EventCard({ detail, now, viewerId }: { detail: EventDetail; now: Date; viewerId: string }) {
  const e = detail.event;
  const metric = e.metric as EventMetric;
  const rewards = e.rewards as EventRewards;
  const share = e.target ? Math.min(100, (e.progress / e.target) * 100) : 0;
  const settled = !!e.settledAt;
  const status = eventStatus(e, now);
  const fmt = (v: number) => formatAmount(metric, v);
  return (
    <article className="panel overflow-hidden">
      <div className="border-b border-asphalt-800 bg-gradient-to-r from-volt-500/15 via-transparent to-gold-400/10 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-display text-xl font-bold"><PartyPopper className="h-5 w-5 shrink-0 text-gold-400" />{tx(e.name)}</h2>
            <p className="mt-1 text-sm font-semibold text-cyan-glow">{goalText({ metric, cargoType: e.cargoType, countryCode: e.countryCode, target: e.target }, detail.countryName)}</p>
            {e.description && <p className="mt-1 max-w-3xl text-sm text-mist-300">{tx(e.description)}</p>}
          </div>
          <EventStatusBadge detail={detail} now={now} />
        </div>
        <div className="mt-4 flex items-center justify-between text-xs text-mist-400">
          <span className="num">{fmt(e.progress)} / {fmt(e.target)}</span>
          <span className="num font-semibold text-white">{Math.floor(share)}%</span>
        </div>
        <Meter value={share} tone={e.progress >= e.target ? 'auto' : 'gold'} className="mt-1" />
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-mist-400">
          <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />{dateTime(e.startsAt)} – {dateTime(e.endsAt)}</span>
          <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{t('{0} участници', int(detail.participants))}</span>
          <span>{t('Участник е всеки с поне {0}', fmt(e.minContribution))}</span>
          {!e.createdBy && <span>{t('автоматичен ивент')}</span>}
        </div>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-[1.3fr_1fr]">
        <div>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Trophy className="h-4 w-4 text-gold-400" />{t('Най-добрите')}</h3>
          {detail.leaders.length === 0 ? (
            <p className="text-sm text-mist-400">{status === 'scheduled' ? t('Ивентът още не е започнал.') : t('Все още никой не е допринесъл. Бъди първият!')}</p>
          ) : (
            <ol className="space-y-1">
              {detail.leaders.map((l, i) => (
                <li key={l.userId} className={`flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm ${l.userId === viewerId ? 'bg-volt-500/15' : ''}`}>
                  <span className={`num w-6 text-right font-bold ${PLACE_TONE[i] ?? 'text-mist-400'}`}>{i < rewards.top.length ? <Crown className="inline h-3.5 w-3.5" /> : null}{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate"><PlayerName name={l.username} role={l.role} vip={isVip(l.vipUntil, now)} />{l.tag && <span className="ml-1.5 text-xs text-mist-400">[{tx(l.tag)}]</span>}</span>
                  <span className="num text-xs text-mist-400">{t('{0} дост.', int(l.deliveries))}</span>
                  <span className="num w-28 text-right font-semibold">{fmt(l.amount)}</span>
                </li>
              ))}
            </ol>
          )}
          {detail.companies.length > 0 && (
            <>
              <h3 className="mb-2 mt-4 text-sm font-semibold">{t('Компании')}</h3>
              <ul className="space-y-1 text-sm">
                {detail.companies.map((c) => (
                  <li key={c.name} className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color ?? '#64748b' }} />
                    <span className="flex-1 truncate">{tx(c.name)} {c.tag && <span className="text-xs text-mist-400">[{tx(c.tag)}]</span>}</span>
                    <span className="num text-xs text-mist-400">{t('{0} души', int(c.members))}</span>
                    <span className="num w-28 text-right">{fmt(c.amount)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-asphalt-700 p-4">
            <div className="label">{t('Твоят принос')}</div>
            {detail.mine ? (
              <>
                <div className="num mt-1 font-display text-2xl font-bold">{fmt(detail.mine.amount)}</div>
                <div className="text-sm text-mist-300">{t('{0} доставки · място {1}', int(detail.mine.deliveries), detail.mine.rank)}</div>
                {detail.mine.amount < e.minContribution && !settled && <p className="mt-1 text-xs text-amber-sig">{t('Още {0} до участник.', fmt(e.minContribution - detail.mine.amount))}</p>}
                {settled && detail.mine.reward && <p className="mt-2 flex items-center gap-1.5 text-sm text-profit"><CheckCircle2 className="h-4 w-4" />{t('Получи: {0}', rewardText(detail.mine.reward))}</p>}
                {settled && !detail.mine.reward && e.outcome !== 'success' && <p className="mt-2 flex items-center gap-1.5 text-sm text-mist-400"><XCircle className="h-4 w-4" />{t('Без награда — целта не беше постигната.')}</p>}
              </>
            ) : (
              <p className="mt-1 text-sm text-mist-400">{settled ? t('Не участва.') : t('Всяка подходяща доставка се брои автоматично.')}</p>
            )}
          </div>
          <div className="rounded-xl border border-gold-400/30 bg-gold-400/5 p-4">
            <div className="label flex items-center gap-1.5"><Gift className="h-3.5 w-3.5 text-gold-400" />{t('Награди, ако целта бъде постигната')}</div>
            <ul className="mt-2 space-y-1 text-sm">
              {rewards.top.map((_, i) => (
                <li key={i} className="flex justify-between gap-3"><span className={`font-semibold ${PLACE_TONE[i] ?? ''}`}>{t('{0} място', i + 1)}</span><span className="text-right">{rewardText(rewardFor(rewards, i + 1))}</span></li>
              ))}
              <li className="flex justify-between gap-3 border-t border-asphalt-800 pt-1"><span className="font-semibold">{t('Всеки участник')}</span><span className="text-right">{rewardText(rewards.participant)}</span></li>
            </ul>
          </div>
        </div>
      </div>
    </article>
  );
}
