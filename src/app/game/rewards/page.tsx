import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui';
import { dailyState } from '@/lib/game/daily';
import { gameContext } from '@/server/game/context';
import { claimableCount } from '@/server/game/missions';
import { passView } from '@/server/game/season-pass';
import { inventoryBadge, weeklyChest } from '@/server/game/item-trade';
import { runningEvents } from '@/server/game/events';
import { bigRunOf, bigRunProgress } from '@/server/game/big-run';
import { t, tx } from '@/i18n/t';
import { monthCardOf, vipCaseReady } from '@/server/game/shop-v2';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Награди') };
}

/**
 * 1.2.2 „Награди“: everything the player collects on one page — first what
 * waits to be taken (one button each), then the inventory, missions, the
 * season pass, events, the Big Run, the workshop and the album as cards.
 */
export default async function RewardsPage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.nav_v2) redirect('/game/inventory');
  const [missions, pass, inv, week, events, run] = await Promise.all([
    claimableCount(db, user.id),
    features.truck_pass ? passView(db, user.id, now) : null,
    features.inventory_menu ? inventoryBadge(db, user.id, user.uiPrefs?.inventorySeenAt, now) : null,
    features.item_chests ? weeklyChest(db, user.id, now) : null,
    runningEvents(db, user.id, now),
    features.big_run ? bigRunOf(db, now) : null,
  ]);
  const runDone = run ? (await bigRunProgress(db, user.id, run)).filter(Boolean).length : 0;
  const daily = !dailyState(user.loginStreak, user.dailyClaimKey, now).claimedToday;

  const take: { href: string; emoji: string; text: string }[] = [];
  if (daily) take.push({ href: '/game#daily', emoji: '📅', text: t('Дневната награда') });
  if (missions > 0) take.push({ href: '/game/missions', emoji: '🎯', text: t('Мисии: {0} награди', missions) });
  if (pass?.claimable) take.push({ href: '/game/seasons', emoji: '🎟️', text: t('Truck Pass: {0} нива', pass.claimable) });
  if (inv?.caseReady) take.push({ href: '/game/inventory', emoji: '📦', text: t('Неотворен кейс') });
  if (week?.tier && !week.claimed) take.push({ href: '/game/inventory', emoji: '🧰', text: t('Седмичен сандък: {0}', week.trips) });
  // 1.2.3: the weekly VIP case and the ТрансКоин of the monthly card.
  if (features.shop_v2) {
    const [vipCase, card] = await Promise.all([vipCaseReady(db, user.id, user.vipUntil, now), monthCardOf(db, user.id, now)]);
    if (vipCase) take.push({ href: '/game/shop', emoji: '👑', text: t('VIP кейс на седмицата') });
    if (card.ready) take.push({ href: '/game/shop', emoji: '💳', text: t('Месечна карта: {0} TC за днес', card.coinsPerDay) });
  }

  const live = events.filter((e) => e.event.startsAt <= now && e.event.endsAt > now);
  const cards = [
    { href: '/game/inventory', emoji: '🎒', title: t('Инвентар'), text: inv?.fresh ? t('{0} нови', inv.fresh) : t('Предмети и кейсове'), on: features.inventory },
    { href: '/game/missions', emoji: '🎯', title: t('Мисии'), text: missions ? t('{0} за взимане', missions) : t('Дневни, седмични и сезонни'), on: true },
    { href: '/game/seasons', emoji: '🎟️', title: t('Сезон и Truck Pass'), text: pass ? t('Ниво {0}', pass.level) : t('Сезонът'), on: true },
    { href: '/game/events', emoji: '🌍', title: t('Ивенти'), text: live.length ? t('{0} тече сега', tx(live[0]!.event.name)) : t('Общи цели за всички играчи'), on: true },
    { href: '/game/big-run', emoji: '🏁', title: t('Голям рейс'), text: run?.legs.length ? t('етап {0} от {1}', Math.min(runDone + 1, run.legs.length), run.legs.length) : t('Седмичният маршрут'), on: features.big_run },
    { href: '/game/inventory/workshop', emoji: '🔧', title: t('Работилница'), text: t('Сглоби по-редки предмети'), on: features.workshop },
    { href: '/game/inventory/album', emoji: '🖼️', title: t('Албум с предмети'), text: t('Колекции и наградите им'), on: features.item_album },
    { href: '/game/inventory/hall', emoji: '🏛️', title: t('Зала на славата'), text: t('Първите колекционери и златните ключове'), on: features.item_album },
  ].filter((c) => c.on);

  return (
    <div className="space-y-6">
      <PageHeader title={t('Награди')} subtitle={t('Всичко, което събираш, на едно място.')} />
      <section>
        <h2 className="label mb-2">{t('Вземи сега')}</h2>
        {take.length ? (
          <ul className="grid gap-2 sm:grid-cols-2" data-testid="rewards-take">
            {take.map((x) => (
              <li key={x.text}>
                <Link href={x.href} className="flex items-center gap-3 rounded-2xl border border-gold-400/50 bg-gold-400/5 p-3 transition hover:-translate-y-0.5">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-asphalt-850 text-2xl" aria-hidden="true">{x.emoji}</span>
                  <span className="min-w-0 flex-1 font-semibold">{x.text}</span>
                  <span className="text-sm font-bold text-gold-400">{t('Вземи')} →</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border border-asphalt-800 p-4 text-sm text-mist-400">{t('Всичко е взето. Нови награди идват с курсовете, мисиите и ивентите.')}</p>
        )}
      </section>
      <section>
        <h2 className="label mb-2">{t('Всичко за събиране')}</h2>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {cards.map((c) => (
            <li key={c.href}>
              <Link href={c.href} className="flex h-full flex-col gap-1 rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-700/10 to-transparent p-3 transition hover:-translate-y-0.5 hover:border-gold-400/60">
                <span className="text-2xl" aria-hidden="true">{c.emoji}</span>
                <span className="font-semibold">{c.title}</span>
                <span className="text-xs text-mist-400">{c.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
