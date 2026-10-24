import { and, eq, gt, sql } from 'drizzle-orm';
import { Ban, Bell, MessageSquare, Paintbrush, Sparkles, UserRoundCheck, LayoutGrid } from 'lucide-react';
import { SEASON_IDS, SEASONS, activeSeason } from '@/lib/game/seasonal';
import { seasonMode } from '@/server/seasonal';
import { ActionButton } from '@/components/ui/ActionButton';
import { blockList } from '@/server/game/moderation';
import { ResendVerification } from '@/components/auth/EmailLinkForms';
import { PushSettings } from '@/components/game/PushSettings';
import { DiscordSettings } from '@/components/game/DiscordSettings';
import { discordConfig } from '@/server/discord/config';
import { DISCORD_LINK_COINS } from '@/server/discord/link';
import { QuietHours } from '@/components/game/QuietHours';
import { Badge, Card, PageHeader } from '@/components/ui';
import { deviceCount, PUSH_CATEGORIES, vapidKeys } from '@/server/push';
import { PasswordForm } from '@/components/game/PasswordForm';
import { date } from '@/lib/format';
import { sessions, users } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';
import { HIRE_RULES } from '@/lib/game/hire';
import { SMUGGLING } from '@/lib/game/smuggling';
import { smugglingProfile } from '@/server/game/smuggling';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Настройки') };
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ discord?: string }> }) {
  await initLocale();
  const { discord: discordStatus } = await searchParams;
  const { db, user, now, features } = await gameContext();
  const site = activeSeason(now, await seasonMode(db));
  const [u] = await db.select({ email: users.email, createdAt: users.createdAt, verified: users.emailVerifiedAt, pushPrefs: users.pushPrefs, discordName: users.discordName, discordId: users.discordId, discordPrefs: users.discordPrefs }).from(users).where(eq(users.id, user.id));
  const [keys, devices, blocked, shade] = await Promise.all([vapidKeys(db), deviceCount(db, user.id), blockList(db, user.id), features.smuggling ? smugglingProfile(db, user.id) : null]);
  const [{ n = 0 } = {}] = await db.select({ n: sql<number>`count(*)::int` }).from(sessions).where(and(eq(sessions.userId, user.id), gt(sessions.expiresAt, new Date())));
  return (
    <div className="space-y-6">
      <PageHeader title={t('Настройки')} subtitle={t('Акаунт, парола и известия.')} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t('Акаунт')}>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div><dt className="label">{t('Потребител')}</dt><dd className="mt-1 font-semibold">{tx(user.username)}</dd></div>
            <div className="col-span-2">
              <dt className="label">{t('Имейл')}</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-2">
                <span>{tx(u?.email)}</span>
                {u?.verified ? <Badge tone="green">{t('потвърден')}</Badge> : <><Badge tone="orange">{t('непотвърден')}</Badge><span className="text-xs"><ResendVerification /></span></>}
              </dd>
            </div>
            <div><dt className="label">{t('Регистрация')}</dt><dd className="mt-1">{u ? date(u.createdAt) : ''}</dd></div>
            <div><dt className="label">{t('Активни сесии')}</dt><dd className="num mt-1">{n}</dd></div>
            <div><dt className="label">{t('Език')}</dt><dd className="mt-1">{t('Български (още езици предстоят)')}</dd></div>
          </dl>
        </Card>
        <Card title={t('Сигурност')}><PasswordForm /></Card>
        {features.discord_bot && (
          <Card title={<span id="discord" className="inline-flex scroll-mt-24 items-center gap-2"><MessageSquare className="h-4 w-4 text-mist-400" />Discord</span>} className="lg:col-span-2">
            <DiscordSettings ready={discordConfig().oauth} linked={u?.discordId ? (u.discordName ?? 'Discord') : null} categories={PUSH_CATEGORIES} prefs={u?.discordPrefs ?? {}} status={discordStatus ?? null} coins={DISCORD_LINK_COINS} />
          </Card>
        )}
        {shade && (
          <Card title={<span className="inline-flex items-center gap-2"><Sparkles className="h-4 w-4 text-mist-400" />{t('Сенчести товари')}</span>} className="lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-mist-300">
                {user.level < SMUGGLING.minLevel ? t('По избор от ниво {0}: вечерни пратки с безобидна „сива“ стока, по-добре платени, но с риск от глоба и конфискация (само игрови пари).', SMUGGLING.minLevel) : shade.optIn ? t('Включено: виждаш вечерните сенчести оферти в „Сенки“.') : t('Изключено: играта е само честна. Можеш да ги включиш по всяко време.')}
              </p>
              {user.level >= SMUGGLING.minLevel && <ActionButton action={{ type: 'smugglingOptIn', on: !shade.optIn }} className="btn-ghost">{shade.optIn ? t('Изключи') : t('Включи')}</ActionButton>}
            </div>
          </Card>
        )}
        {(features.progressive_unlock || features.simple_board) && (
          <Card title={<span className="inline-flex items-center gap-2"><LayoutGrid className="h-4 w-4 text-mist-400" />{t('Как изглежда играта')}</span>} className="lg:col-span-2">
            {features.progressive_unlock && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-mist-300">{user.uiPrefs?.showAll ? t('Менюто показва всичко веднага.') : t('Менюто расте с нивото ти — новите страници се отключват постепенно с кратко обяснение. Страниците винаги се отварят и директно.')}</p>
                <ActionButton action={{ type: 'uiPrefs', showAll: !user.uiPrefs?.showAll }} className="btn-ghost">{user.uiPrefs?.showAll ? t('Постепенно меню') : t('Покажи всичко')}</ActionButton>
              </div>
            )}
            {features.simple_board && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-mist-300">{user.uiPrefs?.boardView === 'full' ? t('Борсата показва всички етикети на поръчките.') : t('Борсата е в прост изглед: маршрут, тонове, пари и подходящ камион; бонусите са в една лента.')}</p>
                <ActionButton action={{ type: 'uiPrefs', boardView: user.uiPrefs?.boardView === 'full' ? 'simple' : 'full' }} className="btn-ghost">{user.uiPrefs?.boardView === 'full' ? t('Прост изглед') : t('Разширен изглед')}</ActionButton>
              </div>
            )}
          </Card>
        )}
        <Card title={<span className="inline-flex items-center gap-2"><Sparkles className="h-4 w-4 text-mist-400" />{t('Празнична украса')}</span>} className="lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="max-w-xl text-mist-300">
              {t('По празници и сезони (')}{SEASON_IDS.map((id) => `${SEASONS[id].label} ${SEASONS[id].from.split('-').reverse().join('.')} – ${SEASONS[id].to.split('-').reverse().join('.')}`).join(', ')}{t(') играта сменя цветовете и добавя украса. {0}', site ? t('В момента е включена: {0}.', SEASONS[site].label) : t('В момента няма празнична тема.'))}
            </p>
            <ActionButton action={{ type: 'seasonalTheme', on: !user.seasonalTheme }} className="btn-ghost">{user.seasonalTheme ? t('Изключи украсата') : t('Включи украсата')}</ActionButton>
          </div>
        </Card>
        {features.livery && (
          <Card title={<span className="inline-flex items-center gap-2"><Paintbrush className="h-4 w-4 text-mist-400" />{t('Ливрея на компанията')}</span>} className="lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <p className="max-w-xl text-mist-300">{t('Ако компанията ти има ливрея, камионите ти са в нейния цвят (специалните бои от магазина остават). {0}', user.companyLivery ? t('В момента носиш ливреята на компанията.') : t('В момента камионите ти са в собствените си цветове.'))}</p>
              <ActionButton action={{ type: 'companyLivery', on: !user.companyLivery }} className="btn-ghost">{user.companyLivery ? t('Собствени цветове') : t('Носи ливреята')}</ActionButton>
            </div>
          </Card>
        )}
        {features.hire && <Card title={<span className="inline-flex items-center gap-2"><UserRoundCheck className="h-4 w-4 text-mist-400" />{t('На разположение за компании')}</span>} className="lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="max-w-xl text-mist-300">
              {t('Компаниите могат да ти възлагат курсове от борсата: товарът се запазва за теб {0} минути, караш със свой камион и при доставката плащаш на компанията уговорена комисиона ({1}–{2} %). Всяко предложение можеш да откажеш. {3}', HIRE_RULES.offerMinutes, Math.round(HIRE_RULES.minShare * 100), Math.round(HIRE_RULES.maxShare * 100), user.forHire ? t('В момента приемаш предложения.') : t('В момента не приемаш предложения.'))}
            </p>
            <ActionButton action={{ type: 'forHire', on: !user.forHire }} className={user.forHire ? 'btn-ghost' : 'btn-primary'}>{user.forHire ? t('Спри предложенията') : t('Приемам курсове')}</ActionButton>
          </div>
        </Card>}
        <Card title={<span className="inline-flex items-center gap-2"><Ban className="h-4 w-4 text-mist-400" />{t('Блокирани играчи')}</span>} className="lg:col-span-2">
          {blocked.length === 0 ? (
            <p className="text-sm text-mist-400">{t('Няма блокирани играчи. Блокира се от картата на играча (натисни името му).')}</p>
          ) : (
            <ul className="divide-y divide-asphalt-800">
              {blocked.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="font-semibold">{tx(b.username)} <span className="font-normal text-mist-400">{t('· от {0}', date(b.at))}</span></span>
                  <ActionButton action={{ type: 'unblockUser', userId: b.id }} className="btn-ghost px-3 py-1.5 text-xs">{t('Отблокирай')}</ActionButton>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={<span className="inline-flex items-center gap-2"><Bell className="h-4 w-4 text-mist-400" />{t('Известия на телефона и компютъра')}</span>} className="lg:col-span-2">
          <p className="mb-4 text-sm text-mist-400">{t('Получавай известие, когато камионът пристигне, има спешна доставка, започва ивент или ти пишат в компанията — дори когато играта е затворена.')}</p>
          <PushSettings publicKey={keys.publicKey} categories={PUSH_CATEGORIES} prefs={u?.pushPrefs ?? {}} devices={devices} />
          <div className="mt-4 border-t border-asphalt-800 pt-4"><QuietHours value={user.quietHours ?? null} /></div>
        </Card>
      </div>
    </div>
  );
}
