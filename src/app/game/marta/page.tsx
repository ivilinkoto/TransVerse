import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Bird, Coins, Gift, Map } from 'lucide-react';
import { Badge, Card, Meter, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { SelectAction } from '@/components/ui/SelectAction';
import { VehicleIllustration } from '@/components/vehicles/VehicleIllustration';
import { money } from '@/lib/format';
import { BADGES, QUEST_BADGE_COINS } from '@/lib/game/halloween';
import { isMarta, MARTA, martaEventWindow } from '@/lib/game/marta';
import { gameContext } from '@/server/game/context';
import { martaState, martenitsasOf, storkOfDay } from '@/server/game/marta';
import { friendsOf } from '@/server/game/social';

export const metadata = { title: 'Баба Марта' };

const day = (d: Date) => d.toLocaleString('bg-BG', { timeZone: 'Europe/Sofia', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export default async function MartaPage() {
  const { db, user, now, features } = await gameContext();
  if (!features.marta) notFound();
  const live = isMarta(now);
  const [state, got, friends, stork] = await Promise.all([martaState(db, user.id), martenitsasOf(db, user.id), friendsOf(db, user.id, now), live ? storkOfDay(db, now) : null]);
  const window = martaEventWindow();
  const badge = BADGES[MARTA.badge]!;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Баба Марта"
        subtitle={live ? 'Честита Баба Марта! Пролетни товари, мартенички по камионите и щъркел над някой град всеки ден.' : 'Баба Марта по пътищата на TransVerse — от 1 до 31 март.'}
        help={`Пролетните товари имат етикет „Баба Марта“ на борсата и се плащат с ${Math.round((MARTA.rewardMultiplier - 1) * 100)}% повече. През март камионите и базата носят мартенички, а ремонтите и профилактиката са с ${Math.round(MARTA.springDiscount * 100)}% по-евтини (пролетно почистване). Всеки ден щъркел каца над един истински град — намери го на картата за ${MARTA.storkCoins} TC. Изпълни четирите мисии за значката „${badge.label}“. Игрови данни.`}
      />
      <section className="panel relative overflow-hidden p-5 sm:p-6">
        <div className="relative">
          <div className="flex flex-wrap items-center gap-2 text-sm"><Badge tone="red">🔴⚪ Ивент „Пролетта идва“: {day(window.startsAt)} – {day(window.endsAt)}</Badge></div>
          <p className="mt-3 max-w-2xl text-sm text-mist-300">Мартенички, цветя и разсад трябва да стигнат навсякъде до 8 март. Брои се всеки пролетен товар — всички участници печелят, а най-добрите получават VIP и ТрансКоин.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/game/contracts" className="btn-primary">Пролетни товари</Link>
            <Link href="/game/events" className="btn-ghost">Класация на ивента</Link>
          </div>
        </div>
      </section>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card title="Мисии на Баба Марта" actions={<span className="text-xs text-mist-400">за всички играчи · веднъж</span>}>
          <ul className="space-y-3">
            {state.quests.map((q) => (
              <li key={q.id} className="rounded-xl border border-asphalt-700 bg-asphalt-850 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{q.title}</span>
                  <span className="num text-xs text-mist-300">{[q.coins ? `${q.coins} TC` : '', q.cents ? money(q.cents) : ''].filter(Boolean).join(' · ')}</span>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <Meter value={(q.progress / q.target) * 100} tone="gold" className="flex-1" />
                  <span className="num w-24 text-right text-xs text-mist-400">{Math.floor(q.progress).toLocaleString('bg-BG')} / {q.target.toLocaleString('bg-BG')}</span>
                  {q.claimed ? <Badge tone="green">взета</Badge> : <ActionButton action={{ type: 'claimMartaQuest', questId: q.id }} className="btn-gold px-3 py-1.5 text-xs" disabled={!q.done}>Вземи</ActionButton>}
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-6">
          <Card title="Щъркелът на деня">
            {stork ? (
              <div className="space-y-2 text-sm">
                <p className="flex items-center gap-2"><Bird className="h-5 w-5 text-mist-200" />Днес кацна някъде на картата. Намери го и кажи „Видях го!“.</p>
                <Link href="/game/map?stork=1" className="btn-primary"><Map className="h-4 w-4" />Търси на картата</Link>
              </div>
            ) : <p className="text-sm text-mist-400">Щъркелите идват на 1 март.</p>}
          </Card>
          <Card title="Мартеничка за приятел">
            {live && friends.friends.length ? (
              <SelectAction label="Подари" ariaLabel="Приятел" value="" options={[{ value: '', label: '— избери приятел —' }, ...friends.friends.map((f) => ({ value: f.id, label: f.username }))]} action={{ type: 'giveMartenitsa' }} field="friendId" />
            ) : <p className="text-sm text-mist-400">{live ? 'Добави приятели, за да им подариш мартеничка.' : 'Мартенички се подаряват през март.'}</p>}
            <p className="mt-3 flex items-center gap-1.5 text-xs text-mist-400"><Gift className="h-3.5 w-3.5" />{got.length ? `Получи мартенички от: ${got.map((g) => g.from).join(', ')}` : 'Още нямаш мартенички тази година.'}</p>
          </Card>
          <Card title="Значка">
            <div className="font-display text-lg font-bold">{badge.label}</div>
            <p className="text-sm text-mist-300">{state.badge ? 'Твоя е — вижда се в профила ти.' : `${badge.description} Плюс ${QUEST_BADGE_COINS} TC.`}</p>
          </Card>
          <Card title="Мартенички по камионите">
            <VehicleIllustration modelId="danubia-t440" trailerModelId="curtain-13" color="#f8fafc" martenitsa className="h-20 w-full" />
            <p className="mt-2 flex items-center gap-1.5 text-xs text-mist-400"><Coins className="h-3.5 w-3.5" />През март всички камиони носят мартенички — безплатно.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
