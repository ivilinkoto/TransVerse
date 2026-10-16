import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Metadata } from 'next';
import { LiveUpdates } from '@/components/game/LiveUpdates';
import { Sidebar } from '@/components/game/Sidebar';
import { TopBar } from '@/components/game/TopBar';
import { notifications } from '@/server/db/schema';
import { TutorialCoach } from '@/components/game/TutorialCoach';
import { isStaff } from '@/server/auth/roles';
import { displayName } from '@/server/game/company';
import { gameContext } from '@/server/game/context';
import { membershipOf } from '@/server/game/membership';
import { tutorialState } from '@/server/game/tutorial';

export const metadata: Metadata = { title: 'Игра' };
export const dynamic = 'force-dynamic';

export default async function GameLayout({ children }: { children: React.ReactNode }) {
  const { db, user, company, hq } = await gameContext();
  const [tutorial, membership] = await Promise.all([tutorialState(db, user.id), membershipOf(db, user.id)]);
  const [{ unread = 0 } = {}] = await db.select({ unread: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <Sidebar unread={unread} staff={isStaff(user.role)} independent={company.kind !== 'company'} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={displayName(membership?.company.name, user.username, company.kind)} kind={company.kind} company={company} user={user} hqName={hq.nameBg} />
        {tutorial.active && tutorial.step && <TutorialCoach step={tutorial.step} index={tutorial.index} total={tutorial.total} />}
        <main className="flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
      <LiveUpdates />
    </div>
  );
}
