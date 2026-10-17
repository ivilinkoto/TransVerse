import { and, eq, gt, sql } from 'drizzle-orm';
import { Bell } from 'lucide-react';
import { ResendVerification } from '@/components/auth/EmailLinkForms';
import { PushSettings } from '@/components/game/PushSettings';
import { Badge, Card, PageHeader } from '@/components/ui';
import { deviceCount, PUSH_CATEGORIES, vapidKeys } from '@/server/push';
import { PasswordForm } from '@/components/game/PasswordForm';
import { date } from '@/lib/format';
import { sessions, users } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';

export const metadata = { title: 'Настройки' };

export default async function SettingsPage() {
  const { db, user } = await gameContext();
  const [u] = await db.select({ email: users.email, createdAt: users.createdAt, verified: users.emailVerifiedAt, pushPrefs: users.pushPrefs }).from(users).where(eq(users.id, user.id));
  const [keys, devices] = await Promise.all([vapidKeys(db), deviceCount(db, user.id)]);
  const [{ n = 0 } = {}] = await db.select({ n: sql<number>`count(*)::int` }).from(sessions).where(and(eq(sessions.userId, user.id), gt(sessions.expiresAt, new Date())));
  return (
    <div className="space-y-6">
      <PageHeader title="Настройки" subtitle="Акаунт, парола и известия." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Акаунт">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div><dt className="label">Потребител</dt><dd className="mt-1 font-semibold">{user.username}</dd></div>
            <div className="col-span-2">
              <dt className="label">Имейл</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-2">
                <span>{u?.email}</span>
                {u?.verified ? <Badge tone="green">потвърден</Badge> : <><Badge tone="orange">непотвърден</Badge><span className="text-xs"><ResendVerification /></span></>}
              </dd>
            </div>
            <div><dt className="label">Регистрация</dt><dd className="mt-1">{u ? date(u.createdAt) : ''}</dd></div>
            <div><dt className="label">Активни сесии</dt><dd className="num mt-1">{n}</dd></div>
            <div><dt className="label">Език</dt><dd className="mt-1">Български (още езици предстоят)</dd></div>
          </dl>
        </Card>
        <Card title="Сигурност"><PasswordForm /></Card>
        <Card title={<span className="inline-flex items-center gap-2"><Bell className="h-4 w-4 text-mist-400" />Известия на телефона и компютъра</span>} className="lg:col-span-2">
          <p className="mb-4 text-sm text-mist-400">Получавай известие, когато камионът пристигне, има спешна доставка, започва ивент или ти пишат в компанията — дори когато играта е затворена.</p>
          <PushSettings publicKey={keys.publicKey} categories={PUSH_CATEGORIES} prefs={u?.pushPrefs ?? {}} devices={devices} />
        </Card>
      </div>
    </div>
  );
}
