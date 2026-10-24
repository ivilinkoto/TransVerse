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
import { t, tx, intlLocale } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Великден') };
}

const day = (d: Date) => d.toLocaleString(intlLocale(), { timeZone: 'Europe/Sofia', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export default async function EasterPage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.easter) notFound();
  const live = isEaster(now);
  const [state, friends] = await Promise.all([easterState(db, user.id), friendsOf(db, user.id, now)]);
  const w = easterEventWindow();
  const badge = BADGES[EASTER.badge]!;
  return (
    <div className="space-y-6">
      <PageHeader
        title={t('Великден')}
        subtitle={live ? t('Христос воскресе! Козунаци и яйца по пътищата, яйчени битки с приятели и пролетна боя.') : t('Великден по пътищата на TransVerse — от 25 април до 9 май (Великден е на 2 май 2027).')}
        help={t('Великденските товари имат етикет „Великден“ и се плащат с {0}% повече. Яйчената битка е без залог: всеки чифт приятели веднъж годишно, победителят получава {1} TC от играта, а на {2} победи — значка „{3}“. Игрови данни.', Math.round((EASTER.rewardMultiplier - 1) * 100), EASTER.eggCoins, EASTER.eggBadgeWins, BADGES[EASTER.eggBadge]?.label)}
      />
      <Card>
        <Badge tone="violet">{t('🥚 Ивент „Великденски рейс“: {0} – {1}', day(w.startsAt), day(w.endsAt))}</Badge>
        <div className="mt-3 flex flex-wrap gap-2"><Link href="/game/contracts" className="btn-primary">{t('Великденски товари')}</Link><Link href="/game/events" className="btn-ghost">{t('Класация на ивента')}</Link></div>
      </Card>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card title={t('Великденски мисии')}>
          <ul className="space-y-3">
            {state.quests.map((q) => (
              <li key={q.id} className="rounded-xl border border-asphalt-700 bg-asphalt-850 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{tx(q.title)}</span><span className="num text-xs text-mist-300">{[q.coins ? `${q.coins} TC` : '', q.cents ? money(q.cents) : ''].filter(Boolean).join(' · ')}</span></div>
                <div className="mt-2 flex items-center gap-3">
                  <Meter value={(q.progress / q.target) * 100} tone="gold" className="flex-1" />
                  <span className="num w-24 text-right text-xs text-mist-400">{Math.floor(q.progress).toLocaleString(intlLocale())} / {q.target.toLocaleString(intlLocale())}</span>
                  {q.claimed ? <Badge tone="green">{t('взета')}</Badge> : <ActionButton action={{ type: 'claimEasterQuest', questId: q.id }} className="btn-gold px-3 py-1.5 text-xs" disabled={!q.done}>{t('Вземи')}</ActionButton>}
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-6">
          <Card title={t('Яйчена битка')}>
            {live && friends.friends.length ? (
              <SelectAction label={t('Чукни се')} ariaLabel={t('Приятел')} value="" options={[{ value: '', label: t('— избери приятел —') }, ...friends.friends.map((f) => ({ value: f.id, label: f.username }))]} action={{ type: 'eggFight' }} field="friendId" />
            ) : <p className="text-sm text-mist-400">{live ? t('Добави приятели, за да се чукнеш с тях.') : t('Яйчените битки са около Великден.')}</p>}
            <p className="mt-2 text-xs text-mist-400">{t('Без залог — по-здравото яйце печели {0} TC от играта.', EASTER.eggCoins)}</p>
          </Card>
          <Card title={t('Значка')}>
            <div className="font-display text-lg font-bold">{tx(badge.label)}</div>
            <p className="text-sm text-mist-300">{state.badge ? t('Твоя е.') : t('{0} Плюс {1} TC.', badge.description, QUEST_BADGE_COINS)}</p>
          </Card>
          <Card title={t('Боя „Великден“')}>
            <VehicleIllustration modelId="danubia-t440" trailerModelId="curtain-13" color={EASTER.paintColor} livery="easter" className="h-20 w-full" />
            <p className="mt-2 text-sm text-mist-300">{t('{0} TC в магазина — само около Великден.', EASTER.paintPrice)}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
