import { and, eq, gt, sql } from 'drizzle-orm';
import { Ban, Bell, Sparkles } from 'lucide-react';
import { SEASONS, activeSeason } from '@/lib/game/seasonal';
import { seasonMode } from '@/server/seasonal';
import { ActionButton } from '@/components/ui/ActionButton';
import { blockList } from '@/server/game/moderation';
import { ResendVerification } from '@/components/auth/EmailLinkForms';
import { PushSettings } from '@/components/game/PushSettings';
import { QuietHours } from '@/components/game/QuietHours';
import { Badge, Card, PageHeader } from '@/components/ui';
import { deviceCount, PUSH_CATEGORIES, vapidKeys } from '@/server/push';
import { PasswordForm } from '@/components/game/PasswordForm';
import { date } from '@/lib/format';
import { sessions, users } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';

export const metadata = { title: 'Настройки' };

export default async function SettingsPage() {
  const { db, user, now } = await gameContext();
  const site = activeSeason(now, await seasonMode(db));
  const [u] = await db.select({ email: users.email, createdAt: users.createdAt, verified: users.emailVerifiedAt, pushPrefs: users.pushPrefs }).from(users).where(eq(users.id, user.id));
  const [keys, devices, blocked] = await Promise.all([vapidKeys(db), deviceCount(db, user.id), blockList(db, user.id)]);
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
        <Card title={<span className="inline-flex items-center gap-2"><Sparkles className="h-4 w-4 text-mist-400" />Празнична украса</span>} className="lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="max-w-xl text-mist-300">
              По празници (сега: {SEASONS.halloween.label}, {SEASONS.halloween.from.split('-').reverse().join('.')} – {SEASONS.halloween.to.split('-').reverse().join('.')}) играта сменя цветовете и добавя украса. {site ? `В момента е включена: ${SEASONS[site].label}.` : 'В момента няма празнична тема.'}
            </p>
            <ActionButton action={{ type: 'seasonalTheme', on: !user.seasonalTheme }} className="btn-ghost">{user.seasonalTheme ? 'Изключи украсата' : 'Включи украсата'}</ActionButton>
          </div>
        </Card>
        <Card title={<span className="inline-flex items-center gap-2"><Ban className="h-4 w-4 text-mist-400" />Блокирани играчи</span>} className="lg:col-span-2">
          {blocked.length === 0 ? (
            <p className="text-sm text-mist-400">Няма блокирани играчи. Блокира се от картата на играча (натисни името му).</p>
          ) : (
            <ul className="divide-y divide-asphalt-800">
              {blocked.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="font-semibold">{b.username} <span className="font-normal text-mist-400">· от {date(b.at)}</span></span>
                  <ActionButton action={{ type: 'unblockUser', userId: b.id }} className="btn-ghost px-3 py-1.5 text-xs">Отблокирай</ActionButton>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={<span className="inline-flex items-center gap-2"><Bell className="h-4 w-4 text-mist-400" />Известия на телефона и компютъра</span>} className="lg:col-span-2">
          <p className="mb-4 text-sm text-mist-400">Получавай известие, когато камионът пристигне, има спешна доставка, започва ивент или ти пишат в компанията — дори когато играта е затворена.</p>
          <PushSettings publicKey={keys.publicKey} categories={PUSH_CATEGORIES} prefs={u?.pushPrefs ?? {}} devices={devices} />
          <div className="mt-4 border-t border-asphalt-800 pt-4"><QuietHours value={user.quietHours ?? null} /></div>
        </Card>
      </div>
    </div>
  );
}
