import { eq } from 'drizzle-orm';
import { CalendarDays, Coins, Moon, PartyPopper, Trophy } from 'lucide-react';
import Link from 'next/link';
import { GhostTruckIcon, PumpkinIcon } from '@/components/seasonal/icons';
import { Badge, Card, Meter, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { VehicleIllustration } from '@/components/vehicles/VehicleIllustration';
import { money } from '@/lib/format';
import { formatAmount, type EventMetric } from '@/lib/game/events';
import { BADGES, HALLOWEEN, QUEST_BADGE_COINS, halloweenEventWindow, isHalloween } from '@/lib/game/halloween';
import { globalEvents } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';
import { halloweenState } from '@/server/game/halloween';

export const metadata = { title: 'Нощта на тиквите' };

const day = (d: Date) => d.toLocaleString('bg-BG', { timeZone: 'Europe/Sofia', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export default async function HalloweenPage() {
  const { db, user, now } = await gameContext();
  const [state, [event]] = await Promise.all([halloweenState(db, user.id), db.select().from(globalEvents).where(eq(globalEvents.template, HALLOWEEN.eventTemplate)).limit(1)]);
  const live = isHalloween(now);
  const window = halloweenEventWindow();
  const claimable = now.getTime() <= window.endsAt.getTime() + 7 * 86_400_000;
  const badge = BADGES[HALLOWEEN.badge]!;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Нощта на тиквите"
        subtitle={live ? 'Хелуин по пътищата на TransVerse — празнични поръчки, ивент, мисии и призрачен камион.' : 'Хелуин 2026 приключи. Благодарим на всички шофьори!'}
        help={`Празничните поръчки имат оранжев етикет „Хелуин“ на борсата и се плащат с ${Math.round((HALLOWEEN.rewardMultiplier - 1) * 100)}% повече. Броят се за общия ивент и за хелуинските мисии. Нощем (22:00–06:00) по пътя може да срещнеш призрачния камион — носи ${HALLOWEEN.ghostCoins} TC. Изпълни всичките четири мисии и вземи значката „${badge.label}“ завинаги. Празничното съдържание е от ${HALLOWEEN.from.split('-').reverse().join('.')} до ${HALLOWEEN.to.split('-').reverse().join('.')}; наградите от мисиите може да вземеш до седмица след ивента.`}
      />

      <section className="panel relative overflow-hidden p-5 sm:p-6">
        <div className="pointer-events-none absolute -right-6 -top-6 opacity-20" aria-hidden="true"><PumpkinIcon className="h-48 w-48" /></div>
        <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="orange"><CalendarDays className="h-3.5 w-3.5" />Ивент: {day(window.startsAt)} – {day(window.endsAt)}</Badge>
              {event && <Badge tone="violet"><Trophy className="h-3.5 w-3.5" />{formatAmount(event.metric as EventMetric, event.progress)} от {formatAmount(event.metric as EventMetric, event.target)}</Badge>}
            </div>
            <h2 className="mt-3 font-display text-xl font-bold">Общият ивент „Нощта на тиквите“</h2>
            <p className="mt-1 max-w-2xl text-sm text-mist-300">Всички заедно доставяме тикви, сладкиши, костюми и фенери. Брои се всяка празнична поръчка. Всеки участник печели {money(2_000_00)}, опит и 20 TC, а най-добрите — VIP и още ТрансКоин.</p>
            {event && <Meter value={(event.progress / Math.max(1, event.target)) * 100} tone="gold" className="mt-3 max-w-xl" />}
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/game/contracts" className="btn-primary"><PumpkinIcon className="h-4 w-4" />Празнични поръчки</Link>
              <Link href="/game/events" className="btn-ghost"><Trophy className="h-4 w-4" />Класация на ивента</Link>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card title="Хелуински мисии" actions={<span className="text-xs text-mist-400">за всички играчи · веднъж</span>}>
          <ul className="space-y-3">
            {state.quests.map((q) => (
              <li key={q.id} className="rounded-xl border border-asphalt-700 bg-asphalt-850 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 font-medium">
                    {q.id === 'h_ghost' ? <GhostTruckIcon className="h-5 w-5 shrink-0" /> : q.id === 'h_night' ? <Moon className="h-5 w-5 shrink-0 text-prestige" /> : <PumpkinIcon className="h-5 w-5 shrink-0" />}
                    {q.title}
                  </span>
                  <span className="num text-xs text-mist-300">{[q.coins ? `${q.coins} TC` : '', q.cents ? money(q.cents) : ''].filter(Boolean).join(' · ')}</span>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <Meter value={(q.progress / q.target) * 100} tone="gold" className="flex-1" />
                  <span className="num w-24 text-right text-xs text-mist-400">{Math.floor(q.progress).toLocaleString('bg-BG')} / {q.target.toLocaleString('bg-BG')}</span>
                  {q.claimed ? (
                    <Badge tone="green">взета</Badge>
                  ) : (
                    <ActionButton action={{ type: 'claimHalloweenQuest', questId: q.id }} className="btn-gold px-3 py-1.5 text-xs" disabled={!q.done || !claimable}>Вземи</ActionButton>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-6">
          <Card title="Значка">
            <div className="flex items-center gap-4">
              <span className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border-2 ${state.badge ? 'border-orange-500 bg-orange-500/15' : 'border-dashed border-asphalt-600 opacity-60'}`}><PumpkinIcon className="h-10 w-10" /></span>
              <div className="min-w-0">
                <div className="font-display text-lg font-bold">{badge.label}</div>
                <p className="text-sm text-mist-300">{state.badge ? 'Твоя е — вижда се в профила ти и на картата на играча.' : `${badge.description} Плюс ${QUEST_BADGE_COINS} TC.`}</p>
              </div>
            </div>
          </Card>
          <Card title="Боя „Тиква“">
            <VehicleIllustration modelId="danubia-t440" trailerModelId="curtain-13" color={HALLOWEEN.pumpkinColor} livery="pumpkin" className="h-20 w-full" />
            <p className="mt-3 text-sm text-mist-300">Празнична боя за твой камион — {HALLOWEEN.paintPrice} TC. Продава се само по Хелуин и остава на камиона.</p>
            <div className="mt-3 flex gap-2">
              {live ? <Link href="/game/shop" className="btn-ghost"><Coins className="h-4 w-4" />Към магазина</Link> : <Badge>Не се продава извън празника</Badge>}
            </div>
          </Card>
          <Card title="Призрачният камион">
            <div className="flex gap-3 text-sm text-mist-300">
              <GhostTruckIcon className="h-12 w-12 shrink-0" />
              <p>Нощем (22:00–06:00) по пътя може да се появи светещ камион без шофьор. Не е опасен — носи {HALLOWEEN.ghostCoins} TC и изпълнява мисия. Колкото повече караш нощем, толкова по-голям е шансът.</p>
            </div>
          </Card>
        </div>
      </div>
      {!live && <p className="flex items-center gap-2 text-sm text-mist-400"><PartyPopper className="h-4 w-4" />До следващия празник!</p>}
    </div>
  );
}
