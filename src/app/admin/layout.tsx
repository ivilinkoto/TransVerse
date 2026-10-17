import { eq, sql } from 'drizzle-orm';
import type { Metadata } from 'next';
import { ShieldCheck } from 'lucide-react';
import { AdminNav } from '@/components/admin/AdminNav';
import { Logo } from '@/components/brand/Logo';
import { adminContext } from '@/server/admin-context';
import { ROLE_LABELS, type Role } from '@/server/auth/roles';
import { supportTickets } from '@/server/db/schema';
import { openReportCount } from '@/server/game/moderation';

export const metadata: Metadata = { title: 'Админ панел', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { db, user } = await adminContext();
  const [{ n = 0 } = {}] = await db.select({ n: sql<number>`count(*)::int` }).from(supportTickets).where(eq(supportTickets.status, 'open'));
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <aside className="border-b border-asphalt-800 bg-asphalt-900/70 px-3 py-4 lg:sticky lg:top-0 lg:h-dvh lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="mb-4 px-2"><Logo href="/admin" /></div>
        <div className="mb-4 hidden rounded-xl border border-prestige/40 bg-prestige/10 px-3 py-2 text-xs lg:block">
          <div className="flex items-center gap-1.5 font-semibold text-prestige"><ShieldCheck className="h-3.5 w-3.5" />{ROLE_LABELS[user.role as Role]}</div>
          <div className="mt-0.5 text-mist-300">{user.username}</div>
        </div>
        <AdminNav openTickets={n} openReports={await openReportCount(db)} />
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
