import { eq } from 'drizzle-orm';
import { CalendarDays, Coins, HandHeart, PartyPopper, Trophy } from 'lucide-react';
import Link from 'next/link';
import { ChristmasTreeIcon, GiftIcon } from '@/components/seasonal/icons';
import { Badge, Card, Meter, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { VehicleIllustration } from '@/components/vehicles/VehicleIllustration';
import { money } from '@/lib/format';
import { CHRISTMAS, christmasEventWindow, isChristmas } from '@/lib/game/christmas';
import { formatAmount, type EventMetric } from '@/lib/game/events';
import { BADGES, QUEST_BADGE_COINS } from '@/lib/game/halloween';
import { ROADSIDE } from '@/lib/game/roadside';
import { globalEvents } from '@/server/db/schema';
import { christmasState } from '@/server/game/christmas';
import { gameContext } from '@/server/game/context';

export const metadata = { title: 'Коледна треска' };

const day = (d: Date) => d.toLocaleString('bg-BG', { timeZone: 'Europe/Sofia', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const dm = (md: string) => md.split('-').reverse().join('.');

export default async function ChristmasPage() {
  const { db, user, now } = await gameContext();
  const [state, [event]] = await Promise.all([christmasState(db, user.id), db.select().from(globalEvents).where(eq(globalEvents.template, CHRISTMAS.eventTemplate)).limit(1)]);
  const live = isChristmas(now);
  const window = christmasEventWindow();
  const badge = BADGES[CHRISTMAS.badge]!;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Коледна треска"
        subtitle={live ? 'Коледа по пътищата на TransVerse — подаръци до Бъдни вечер, коледни мисии и празнична боя.' : 'Коледа 2026 по пътищата на TransVerse — от 15 декември.'}
        help={`Коледните поръчки имат червен етикет „Коледа“ на борсата и се плащат с ${Math.round((CHRISTMAS.rewardMultiplier - 1) * 100)}% повече. Броят се за общия ивент и за коледните мисии. Изпълни всичките четири мисии и вземи значката „${badge.label}“ завинаги. Празничното съдържание е от ${dm(CHRISTMAS.from)} до ${dm(CHRISTMAS.to)}; наградите от мисиите може да вземеш до края на празника.`}
      />

      <section className="panel relative overflow-hidden p-5 sm:p-6">
        <div className="pointer-events-none absolute -right-6 -top-6 opacity-20" aria-hidden="true"><ChristmasTreeIcon className="h-48 w-48" /></div>
        <div className="relative">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="red"><CalendarDays className="h-3.5 w-3.5" />Ивент: {day(window.startsAt)} – {day(window.endsAt)}</Badge>
            {event && <Badge tone="violet"><Trophy className="h-3.5 w-3.5" />{formatAmount(event.metric as EventMetric, event.progress)} от {formatAmount(event.metric as EventMetric, event.target)}</Badge>}
          </div>
          <h2 className="mt-3 font-display text-xl font-bold">Общият ивент „Коледна треска“</h2>
          <p className="mt-1 max-w-2xl text-sm text-mist-300">Подаръци, елхи, козунаци и мандарини трябва да стигнат до Бъдни вечер. Брои се всяка коледна поръчка. Всеки участник печели {money(2_000_00)}, опит и 20 TC, а най-добрите — VIP и още ТрансКоин.</p>
          {event && <Meter value={(event.progress / Math.max(1, event.target)) * 100} tone="gold" className="mt-3 max-w-xl" />}
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/game/contracts" className="btn-primary"><GiftIcon className="h-4 w-4" />Коледни поръчки</Link>
            <Link href="/game/events" className="btn-ghost"><Trophy className="h-4 w-4" />Класация на ивента</Link>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card title="Коледни мисии" actions={<span className="text-xs text-mist-400">за всички играчи · веднъж</span>}>
          <ul className="space-y-3">
            {state.quests.map((q) => (
              <li key={q.id} className="rounded-xl border border-asphalt-700 bg-asphalt-850 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 font-medium">
                    {q.id === 'c_help' ? <HandHeart className="h-5 w-5 shrink-0 text-gold-400" /> : q.id === 'c_eve' ? <ChristmasTreeIcon className="h-5 w-5 shrink-0" /> : <GiftIcon className="h-5 w-5 shrink-0" />}
                    {q.title}
                  </span>
                  <span className="num text-xs text-mist-300">{[q.coins ? `${q.coins} TC` : '', q.cents ? money(q.cents) : ''].filter(Boolean).join(' · ')}</span>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <Meter value={(q.progress / q.target) * 100} tone="gold" className="flex-1" />
                  <span className="num w-24 text-right text-xs text-mist-400">{Math.floor(q.progress).toLocaleString('bg-BG')} / {q.target.toLocaleString('bg-BG')}</span>
                  {q.claimed ? <Badge tone="green">взета</Badge> : <ActionButton action={{ type: 'claimChristmasQuest', questId: q.id }} className="btn-gold px-3 py-1.5 text-xs" disabled={!q.done}>Вземи</ActionButton>}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-mist-400">Помощ на пътя: когато приятел или колега закъса, помогни му от картата (камион до {ROADSIDE.radiusKm} км).</p>
        </Card>

        <div className="space-y-6">
          <Card title="Значка">
            <div className="flex items-center gap-4">
              <span className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border-2 ${state.badge ? 'border-red-500 bg-red-500/15' : 'border-dashed border-asphalt-600 opacity-60'}`}><ChristmasTreeIcon className="h-10 w-10" /></span>
              <div className="min-w-0">
                <div className="font-display text-lg font-bold">{badge.label}</div>
                <p className="text-sm text-mist-300">{state.badge ? 'Твоя е — вижда се в профила ти и на картата на играча.' : `${badge.description} Плюс ${QUEST_BADGE_COINS} TC.`}</p>
              </div>
            </div>
          </Card>
          <Card title="Боя „Коледа“">
            <VehicleIllustration modelId="danubia-t440" trailerModelId="curtain-13" color={CHRISTMAS.paintColor} livery="christmas" className="h-20 w-full" />
            <p className="mt-3 text-sm text-mist-300">Празнична червена боя с украсена елха — {CHRISTMAS.paintPrice} TC. Продава се само по Коледа и остава на камиона.</p>
            <div className="mt-3 flex gap-2">{live ? <Link href="/game/shop" className="btn-ghost"><Coins className="h-4 w-4" />Към магазина</Link> : <Badge>Продава се от {dm(CHRISTMAS.from)}</Badge>}</div>
          </Card>
        </div>
      </div>
      {!live && <p className="flex items-center gap-2 text-sm text-mist-400"><PartyPopper className="h-4 w-4" />Очакваме празника!</p>}
    </div>
  );
}
