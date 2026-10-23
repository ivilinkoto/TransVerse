import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Card, Meter, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { SelectAction } from '@/components/ui/SelectAction';
import { VehicleIllustration } from '@/components/vehicles/VehicleIllustration';
import { money } from '@/lib/format';
import { EASTER, easterEventWindow, isEaster } from '@/lib/game/easter';
import { BADGES, QUEST_BADGE_COINS } from '@/lib/game/halloween';
import { gameContext } from '@/server/game/context';
import { easterState } from '@/server/game/easter';
import { friendsOf } from '@/server/game/social';

export const metadata = { title: 'Великден' };

const day = (d: Date) => d.toLocaleString('bg-BG', { timeZone: 'Europe/Sofia', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export default async function EasterPage() {
  const { db, user, now, features } = await gameContext();
  if (!features.easter) notFound();
  const live = isEaster(now);
  const [state, friends] = await Promise.all([easterState(db, user.id), friendsOf(db, user.id, now)]);
  const w = easterEventWindow();
  const badge = BADGES[EASTER.badge]!;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Великден"
        subtitle={live ? 'Христос воскресе! Козунаци и яйца по пътищата, яйчени битки с приятели и пролетна боя.' : 'Великден по пътищата на TransVerse — от 25 април до 9 май (Великден е на 2 май 2027).'}
        help={`Великденските товари имат етикет „Великден“ и се плащат с ${Math.round((EASTER.rewardMultiplier - 1) * 100)}% повече. Яйчената битка е без залог: всеки чифт приятели веднъж годишно, победителят получава ${EASTER.eggCoins} TC от играта, а на ${EASTER.eggBadgeWins} победи — значка „${BADGES[EASTER.eggBadge]?.label}“. Игрови данни.`}
      />
      <Card>
        <Badge tone="violet">🥚 Ивент „Великденски рейс“: {day(w.startsAt)} – {day(w.endsAt)}</Badge>
        <div className="mt-3 flex flex-wrap gap-2"><Link href="/game/contracts" className="btn-primary">Великденски товари</Link><Link href="/game/events" className="btn-ghost">Класация на ивента</Link></div>
      </Card>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card title="Великденски мисии">
          <ul className="space-y-3">
            {state.quests.map((q) => (
              <li key={q.id} className="rounded-xl border border-asphalt-700 bg-asphalt-850 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{q.title}</span><span className="num text-xs text-mist-300">{[q.coins ? `${q.coins} TC` : '', q.cents ? money(q.cents) : ''].filter(Boolean).join(' · ')}</span></div>
                <div className="mt-2 flex items-center gap-3">
                  <Meter value={(q.progress / q.target) * 100} tone="gold" className="flex-1" />
                  <span className="num w-24 text-right text-xs text-mist-400">{Math.floor(q.progress).toLocaleString('bg-BG')} / {q.target.toLocaleString('bg-BG')}</span>
                  {q.claimed ? <Badge tone="green">взета</Badge> : <ActionButton action={{ type: 'claimEasterQuest', questId: q.id }} className="btn-gold px-3 py-1.5 text-xs" disabled={!q.done}>Вземи</ActionButton>}
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-6">
          <Card title="Яйчена битка">
            {live && friends.friends.length ? (
              <SelectAction label="Чукни се" ariaLabel="Приятел" value="" options={[{ value: '', label: '— избери приятел —' }, ...friends.friends.map((f) => ({ value: f.id, label: f.username }))]} action={{ type: 'eggFight' }} field="friendId" />
            ) : <p className="text-sm text-mist-400">{live ? 'Добави приятели, за да се чукнеш с тях.' : 'Яйчените битки са около Великден.'}</p>}
            <p className="mt-2 text-xs text-mist-400">Без залог — по-здравото яйце печели {EASTER.eggCoins} TC от играта.</p>
          </Card>
          <Card title="Значка">
            <div className="font-display text-lg font-bold">{badge.label}</div>
            <p className="text-sm text-mist-300">{state.badge ? 'Твоя е.' : `${badge.description} Плюс ${QUEST_BADGE_COINS} TC.`}</p>
          </Card>
          <Card title="Боя „Великден“">
            <VehicleIllustration modelId="danubia-t440" trailerModelId="curtain-13" color={EASTER.paintColor} livery="easter" className="h-20 w-full" />
            <p className="mt-2 text-sm text-mist-300">{EASTER.paintPrice} TC в магазина — само около Великден.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
