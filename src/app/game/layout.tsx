import { and, eq, isNull, lte, sql } from 'drizzle-orm';
import type { Metadata } from 'next';
import { MailWarning } from 'lucide-react';
import { ResendVerification } from '@/components/auth/EmailLinkForms';
import { LiveUpdates } from '@/components/game/LiveUpdates';
import { InstallAppBanner, RegisterServiceWorker } from '@/components/game/PushSettings';
import { mailConfig } from '@/server/mail';
import { dailyState } from '@/lib/game/daily';
import { Sidebar } from '@/components/game/Sidebar';
import { TopBar } from '@/components/game/TopBar';
import { globalEvents, notifications } from '@/server/db/schema';
import { TutorialCoach } from '@/components/game/TutorialCoach';
import { isStaff } from '@/server/auth/roles';
import { displayName } from '@/server/game/company';
import { gameContext } from '@/server/game/context';
import { membershipOf } from '@/server/game/membership';
import { claimableCount } from '@/server/game/missions';
import { isVip } from '@/lib/game/vip';
import { tutorialState } from '@/server/game/tutorial';

export const metadata: Metadata = { title: 'Игра' };
export const dynamic = 'force-dynamic';

export default async function GameLayout({ children }: { children: React.ReactNode }) {
  const { db, user, company, hq, now } = await gameContext();
  const [tutorial, membership, missions] = await Promise.all([tutorialState(db, user.id), membershipOf(db, user.id), claimableCount(db, user.id)]);
  const [{ unread = 0 } = {}] = await db.select({ unread: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
  const [live] = await db.select({ id: globalEvents.id }).from(globalEvents).where(and(isNull(globalEvents.settledAt), isNull(globalEvents.completedAt), lte(globalEvents.startsAt, now), sql`${globalEvents.endsAt} > ${now}`)).limit(1);
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <Sidebar independent={company.kind !== 'company' && !membership} missions={missions} eventLive={!!live} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={displayName(membership?.company.name, user.username, company.kind)} kind={company.kind} company={company} user={user} vip={isVip(user.vipUntil, now)} hqName={hq.nameBg} unread={unread} staff={isStaff(user.role)} dailyReady={!dailyState(user.loginStreak, user.dailyClaimKey, now).claimedToday} />
        <InstallAppBanner />
        {!user.emailVerifiedAt && mailConfig().enabled && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-amber-sig/30 bg-amber-sig/10 px-4 py-2 text-sm sm:px-6">
            <MailWarning className="h-4 w-4 text-amber-sig" />
            <span>Потвърди имейла си <span className="font-semibold">{user.email}</span> — така ще можеш да си върнеш профила и да пазаруваш.</span>
            <ResendVerification />
          </div>
        )}
        {tutorial.active && tutorial.step && <TutorialCoach step={tutorial.step} index={tutorial.index} total={tutorial.total} />}
        <main className="flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
      <LiveUpdates />
      <RegisterServiceWorker />
    </div>
  );
}
