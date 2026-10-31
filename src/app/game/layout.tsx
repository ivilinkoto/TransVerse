import { and, eq, isNull, lte, sql } from 'drizzle-orm';
import type { Metadata } from 'next';
import { Eye, MailWarning } from 'lucide-react';
import { ResendVerification } from '@/components/auth/EmailLinkForms';
import { LiveUpdates } from '@/components/game/LiveUpdates';
import { TabBadge } from '@/components/game/TabBadge';
import { WelcomeBack } from '@/components/game/WelcomeBack';
import { welcomeBack } from '@/server/game/welcome-back';
import { ChatDock } from '@/components/game/ChatDock';
import { PlayerCardHost } from '@/components/game/PlayerCard';
import { ReportHost } from '@/components/game/ReportDialog';
import { InstallAppBanner, RegisterServiceWorker } from '@/components/game/PushSettings';
import { mailConfig } from '@/server/mail';
import { dailyState } from '@/lib/game/daily';
import { MobileNav, SectionTabs, Sidebar } from '@/components/game/Sidebar';
import { TopBar } from '@/components/game/TopBar';
import { globalEvents, notifications } from '@/server/db/schema';
import { TutorialCoach } from '@/components/game/TutorialCoach';
import { ReleaseBody, ReleaseTitle } from '@/components/game/ReleaseNotes';
import { WhatsNew } from '@/components/game/WhatsNew';
import { currentVersion, unseenRelease } from '@/lib/game/releases';
import { isHalloween } from '@/lib/game/halloween';
import { staffAttention } from '@/server/admin';
import { FeaturesProvider, PlayerUiProvider } from '@/components/game/Features';
import { UnlockNotice } from '@/components/game/UnlockNotice';
import { unlockTabs } from '@/components/game/nav';
import { UNLOCK_INFO } from '@/lib/game/unlocks';
import { pendingUnlocks } from '@/server/game/ui-prefs';
import { liveFeatures } from '@/lib/game/features';
import { isChristmas } from '@/lib/game/christmas';
import { isMarta } from '@/lib/game/marta';
import { isEaster } from '@/lib/game/easter';
import { isStaff, testsUnreleased } from '@/server/auth/roles';
import { ActionButton } from '@/components/ui/ActionButton';
import { TermsPrompt } from '@/components/game/TermsPrompt';
import { BroadcastBanner } from '@/components/game/BroadcastBanner';
import { activeBroadcast } from '@/server/broadcast';
import { EMAIL_REWARD_COINS } from '@/server/auth/email-reward';
import { gameContext } from '@/server/game/context';
import { membershipOf } from '@/server/game/membership';
import { claimableCount } from '@/server/game/missions';
import { isVip } from '@/lib/game/vip';
import { tutorialState } from '@/server/game/tutorial';
import { isSpring } from '@/lib/game/spring';
import { t as tr, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: tr('Игра') };
}
export const dynamic = 'force-dynamic';

export default async function GameLayout({ children }: { children: React.ReactNode }) {
  await initLocale();
  const { db, user, company, hq, now } = await gameContext();
  const staff = isStaff(user.role);
  // 1.1.2: staff who look at the game as a player see what players see (no unreleased features, no staff badges).
  const testing = testsUnreleased(user);
  const fresh = unseenRelease(user.seenVersion, now, testing);
  const holiday = [isHalloween(now) && 'halloween', isChristmas(now) && 'christmas', isMarta(now) && 'marta', isSpring(now) && 'spring', isEaster(now) && 'easter'].filter(Boolean).join(',') || null;
  // Everything the frame needs, at once (it renders on every page).
  const [attention, tutorial, membership, missions, [{ unread = 0 } = {}], [live], broadcast] = await Promise.all([
    // Staff see a badge on the admin button while support questions or reports wait.
    staff ? staffAttention(db).then((a) => a.total) : 0,
    tutorialState(db, user.id),
    membershipOf(db, user.id),
    claimableCount(db, user.id),
    db.select({ unread: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, user.id), isNull(notifications.readAt))),
    db.select({ id: globalEvents.id }).from(globalEvents).where(and(isNull(globalEvents.settledAt), isNull(globalEvents.completedAt), lte(globalEvents.startsAt, now), sql`${globalEvents.endsAt} > ${now}`)).limit(1),
    // 1.1.3: the team's message for everyone.
    activeBroadcast(db, now),
  ]);
  // v1.9: pages the player's level just unlocked in the menu ("Ново за теб").
  const features = liveFeatures(now, testing);
  const unlockable = unlockTabs().filter((t) => !t.feature || features[t.feature]).map((t) => ({ ...t, minLevel: t.minLevel! }));
  // 1.1.4.1 „Докато те нямаше“ — not on top of the release notes or the tutorial.
  const back = features.welcome_back && !fresh && !(tutorial.active && tutorial.step) ? await welcomeBack(db, company.id, user.id, user.lastSeenAt, now) : null;
  const pending = features.progressive_unlock && !user.uiPrefs?.showAll && !(tutorial.active && tutorial.step) && !fresh ? await pendingUnlocks(db, user, unlockable) : [];
  const unlocks = pending.flatMap((href) => {
    const t = unlockable.find((x) => x.href === href);
    const info = UNLOCK_INFO[href];
    return t && info ? [{ href, label: t.label, section: t.section, ...info }] : [];
  });
  return (
    <FeaturesProvider value={features}>
      <PlayerUiProvider value={{ level: user.level, showAll: !!user.uiPrefs?.showAll, staff: testing }}>
      <div className="flex min-h-dvh flex-col lg:flex-row" data-look={features.new_look ? '2' : undefined}>
        <Sidebar badges={{ missions, eventLive: !!live }} version={currentVersion(now, testing)} staff={isStaff(user.role)} holiday={holiday} attention={attention} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar title={membership?.company.name ?? user.username} kind={company.kind} company={company} user={user} vip={isVip(user.vipUntil, now)} hqName={hq.nameBg} unread={unread} staff={isStaff(user.role)} attention={attention} dailyReady={!dailyState(user.loginStreak, user.dailyClaimKey, now).claimedToday} />
          <InstallAppBanner />
          {broadcast && <BroadcastBanner text={broadcast.text} tone={broadcast.tone} setAt={broadcast.setAt} />}
          {staff && !testing && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-cyan-glow/30 bg-cyan-glow/10 px-4 py-2 text-sm sm:px-6">
              <Eye className="h-4 w-4 text-cyan-glow" />
              <span>{tr('Гледаш играта като играч: без неиздадените функции и без значките на екипа.')}</span>
              <ActionButton action={{ type: 'uiPrefs', asPlayer: false }} className="btn-ghost px-3 py-1 text-xs">{tr('Върни изгледа на екипа')}</ActionButton>
            </div>
          )}
          {!user.emailVerifiedAt && mailConfig().enabled && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-amber-sig/30 bg-amber-sig/10 px-4 py-2 text-sm sm:px-6">
              <MailWarning className="h-4 w-4 text-amber-sig" />
              <span>{tr('Потвърди имейла си')}{' '}<span className="font-semibold">{tx(user.email)}</span>{' '}{tr('— така ще можеш да си върнеш профила и да пазаруваш.')}{features.email_reward ? <>{' '}<span className="font-semibold text-gold-400">{tr('+{0} ТрансКоин за потвърждението.', EMAIL_REWARD_COINS)}</span></> : null}</span>
              <ResendVerification />
              <span className="basis-full text-xs text-mist-400 sm:basis-auto">{tr('Не виждаш писмото? Провери „Спам“ / „Нежелана поща“.')}</span>
            </div>
          )}
          {tutorial.active && tutorial.step && <TutorialCoach step={tutorial.step} index={tutorial.index} total={tutorial.total} />}
          <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-28 pt-5 sm:px-6 lg:pb-10 lg:pt-6">
            <SectionTabs holiday={holiday} />
            {children}
          </main>
        </div>
        <MobileNav badges={{ missions, eventLive: !!live }} staff={isStaff(user.role)} holiday={holiday} attention={attention} />
        <LiveUpdates />
        {features.tab_badge && <TabBadge unread={unread} />}
        <ChatDock />
        <PlayerCardHost />
        <ReportHost />
        <RegisterServiceWorker />
        {!user.termsAcceptedAt && <TermsPrompt />}
        {unlocks.length > 0 && <UnlockNotice items={unlocks} />}
        {back && !unlocks.length && <WelcomeBack summary={back} />}
        {fresh && !(tutorial.active && tutorial.step) && (
          <WhatsNew version={fresh.version}>
            <ReleaseTitle release={fresh} />
            <div className="mt-5"><ReleaseBody release={fresh} /></div>
          </WhatsNew>
        )}
      </div>
      </PlayerUiProvider>
    </FeaturesProvider>
  );
}
