import { and, eq, gt, sql } from 'drizzle-orm';
import { Card, PageHeader } from '@/components/ui';
import { PasswordForm } from '@/components/game/PasswordForm';
import { date } from '@/lib/format';
import { sessions, users } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';

export const metadata = { title: 'Профил и настройки' };

export default async function ProfilePage() {
  const { db, user } = await gameContext();
  const [u] = await db.select({ email: users.email, createdAt: users.createdAt }).from(users).where(eq(users.id, user.id));
  const [{ n = 0 } = {}] = await db.select({ n: sql<number>`count(*)::int` }).from(sessions).where(and(eq(sessions.userId, user.id), gt(sessions.expiresAt, new Date())));
  return (
    <div className="space-y-6">
      <PageHeader title="Профил и настройки" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Профил">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div><dt className="label">Потребител</dt><dd className="mt-1 font-semibold">{user.username}</dd></div>
            <div><dt className="label">Имейл</dt><dd className="mt-1">{u?.email}</dd></div>
            <div><dt className="label">Регистрация</dt><dd className="mt-1">{u ? date(u.createdAt) : ''}</dd></div>
            <div><dt className="label">Активни сесии</dt><dd className="num mt-1">{n}</dd></div>
            <div><dt className="label">Език</dt><dd className="mt-1">Български (още езици предстоят)</dd></div>
          </dl>
        </Card>
        <Card title="Сигурност"><PasswordForm /></Card>
      </div>
    </div>
  );
}
