import { notFound } from 'next/navigation';
import { AdjustBalanceForm } from '@/components/admin/AdjustBalanceForm';
import { BanForm } from '@/components/admin/BanForm';
import { ResetBrandingForm } from '@/components/admin/ResetBrandingForm';
import { VipForm } from '@/components/admin/VipForm';
import { CoinsForm } from '@/components/admin/CoinsForm';
import { ResetLinkButton } from '@/components/admin/ResetLinkButton';
import { ActionButton } from '@/components/ui/ActionButton';
import { isVip } from '@/lib/game/vip';
import { Badge, Card, PageHeader } from '@/components/ui';
import { SelectAction } from '@/components/ui/SelectAction';
import { date, dateTime, int, km, money } from '@/lib/format';
import { userDetail } from '@/server/admin';
import { truckBlock } from '@/lib/game/truck-ready';
import { fleetView } from '@/server/game/queries';
import { loginHistory } from '@/server/auth/login-events';
import { pendingDeletion } from '@/server/auth/account-close';
import { adminContext } from '@/server/admin-context';
import { describeAudit } from '@/server/audit-format';
import { canBan, canChangeRole, isAdmin, ROLE_LABELS, type Role } from '@/server/auth/roles';
import { GameError } from '@/server/game/errors';
import { moneyBySource, xpBySource } from '@/server/game/progression';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Потребител') };
}

export default async function AdminUser({ params }: { params: Promise<{ id: string }> }) {
  await initLocale();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { db, user: actor, now } = await adminContext();
  const detail = await userDetail(db, id).catch((e) => {
    if (e instanceof GameError) notFound();
    throw e;
  });
  const { user, company, org } = detail;
  const [xp, cash, fleet, logins, deletingAt] = await Promise.all([xpBySource(db, user.id, 7, now), company ? moneyBySource(db, company.id, 7, now) : Promise.resolve([]), company ? fleetView(db, company.id) : Promise.resolve(null), loginHistory(db, user.id, now), pendingDeletion(db, user.id)]);
  const roleOptions = (['player', 'support', 'admin'] as const).filter((r) => r === user.role || canChangeRole(actor.role, actor.id, user.role, user.id, r));
  return (
    <div className="space-y-6">
      <PageHeader title={tx(user.username)} subtitle={<span className="inline-flex flex-wrap items-center gap-2">{tx(user.email)}<Badge tone={user.role === 'player' ? 'neutral' : 'violet'}>{tx(ROLE_LABELS[user.role as Role])}</Badge>{isVip(user.vipUntil, now) && <Badge tone="gold">{t('VIP до {0}', date(user.vipUntil!))}</Badge>}{user.bannedAt && <Badge tone="red">{t('блокиран от {0}', date(user.bannedAt))}</Badge>}</span>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t('Профил и игра')}>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="label">{t('Регистрация')}</dt><dd className="mt-1">{dateTime(user.createdAt)}</dd></div>
            <div><dt className="label">{t('Последен вход')}</dt><dd className="mt-1">{user.lastSeenAt ? dateTime(user.lastSeenAt) : '—'}</dd></div>
            <div><dt className="label">{t('Ниво / опит')}</dt><dd className="num mt-1">{tx(user.level)} / {int(user.xp)}</dd></div>
            <div><dt className="label">{t('Статус')}</dt><dd className="mt-1">{org ? t('{0} на „{1}“ (каса {2})', org.ownerId === user.id ? t('Собственик') : t('Член'), org.name, money(org.treasuryCents)) : company?.kind === 'company' ? t('Лицензиран превозвач без компания') : t('Самостоятелен шофьор')}</dd></div>
            <div><dt className="label">{t('Баланс')}</dt><dd className="num mt-1">{company ? money(company.balanceCents) : '—'}</dd></div>
            <div><dt className="label">{t('Доставки')}</dt><dd className="num mt-1">{company?.deliveries ?? 0} · {km(company?.totalKm ?? 0)}</dd></div>
            {user.banReason && <div className="col-span-2"><dt className="label">{t('Причина за блокиране')}</dt><dd className="mt-1">{tx(user.banReason)}</dd></div>}
          </dl>
        </Card>
        {/* 1.1.3: what each truck is doing and why it may stand — the usual support question. */}
        <Card title={t('Камиони')}>
          {!fleet || fleet.vehicles.length === 0 ? <p className="text-sm text-mist-400">{t('Няма превозни средства.')}</p> : (
            <ul className="space-y-2 text-sm">
              {fleet.vehicles.map((v) => {
                const block = truckBlock(v, now);
                return (
                  <li key={v.id} className="rounded-lg bg-asphalt-850 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">{tx(v.plate)} <span className="font-normal text-mist-400">· {tx(v.model.name)} · {tx(v.city.nameBg)}{v.ownership === 'rented' ? t(' · нает') : ''}</span></span>
                      {v.delivery ? <Badge tone="cyan">{t('на курс до {0}', dateTime(v.delivery.etaAt))}</Badge> : block ? <Badge tone="red">{t('не може да кара')}</Badge> : <Badge tone="green">{t('свободен')}</Badge>}
                    </div>
                    {block && <p className="mt-1 text-xs text-amber-sig">{t(block.reason)}</p>}
                    {v.autoDispatch && <p className="mt-1 text-xs text-mist-300">{t('VIP диспечер: включен')}{v.autoDispatchNote ? t(' · не изпраща: {0}', t(v.autoDispatchNote)) : ''}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        {/* 1.1.3: sign-ins of the last 30 days (device and time) — for "someone got into my profile". */}
        <Card title={t('Влизания (30 дни)')} className="lg:col-span-2" actions={deletingAt ? <Badge tone="red">{t('изтрива се на {0}', date(deletingAt))}</Badge> : undefined}>
          {logins.length === 0 ? <p className="text-sm text-mist-400">{t('Няма записани влизания (записват се от 1.1.3).')}</p> : (
            <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {logins.slice(0, 30).map((l, i) => <li key={i} className="flex justify-between gap-3"><span>{tx(l.device)}</span><span className="shrink-0 text-xs text-mist-400">{dateTime(l.at)}</span></li>)}
            </ul>
          )}
          {logins.length > 0 && <p className="mt-2 text-xs text-mist-400">{t('Различни устройства: {0}', new Set(logins.map((l) => l.device)).size)}</p>}
        </Card>
        <Card title={t('Последните 7 дни: опит и пари по източници')} className="lg:col-span-2">
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <div className="label mb-1.5">{t('Опит · общо')}{' '}{int(xp.reduce((s, r) => s + r.xp, 0))}</div>
              {xp.length === 0 ? <p className="text-sm text-mist-400">{t('Няма записи (записват се от v1.2).')}</p> : (
                <ul className="space-y-1 text-sm">{xp.map((r) => <li key={r.reason} className="flex justify-between gap-2"><span>{tx(r.label)} <span className="text-mist-400">· {tx(r.n)}×</span></span><span className="num">{int(r.xp)}</span></li>)}</ul>
              )}
            </div>
            <div>
              <div className="label mb-1.5">{t('Пари · нето')}{' '}{money(cash.reduce((s, r) => s + r.cents, 0))}</div>
              {cash.length === 0 ? <p className="text-sm text-mist-400">{t('Няма движения.')}</p> : (
                <ul className="space-y-1 text-sm">{cash.slice(0, 12).map((r) => <li key={r.category} className="flex justify-between gap-2"><span>{tx(r.label)} <span className="text-mist-400">· {tx(r.n)}×</span></span><span className={`num ${r.cents < 0 ? 'text-loss' : 'text-profit'}`}>{money(r.cents)}</span></li>)}</ul>
              )}
            </div>
          </div>
        </Card>
        <Card title={t('Управление')}>
          <div className="space-y-5">
            <div>
              <div className="label mb-1.5">{t('Длъжност')}</div>
              {roleOptions.length > 1 ? (
                <SelectAction endpoint="/api/admin/action" label={t('Запази')} ariaLabel={t('Длъжност')} value={user.role} options={roleOptions.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} action={{ type: 'setRole', userId: user.id }} field="role" />
              ) : (
                <p className="text-sm text-mist-400">{t('{0} — нямате право да променяте тази длъжност.', ROLE_LABELS[user.role as Role])}</p>
              )}
            </div>
            {canBan(actor.role, actor.id, user.role, user.id) && (
              <div>
                <div className="label mb-1.5">{t('Достъп')}</div>
                <BanForm userId={user.id} banned={!!user.bannedAt} />
              </div>
            )}
            {org && org.ownerId === user.id && (
              <div>
                <div className="label mb-1.5">{t('Модерация на компанията (')}<a className="text-cyan-glow hover:underline" href={`/game/companies/${org.id}`}>{t('публичен профил')}</a>)</div>
                <ResetBrandingForm companyId={org.id} />
              </div>
            )}
            {isAdmin(actor.role) && (
              <div>
                <div className="label mb-1.5">{t('ТрансКоин')}</div>
                <CoinsForm userId={user.id} balance={user.coins} />
              </div>
            )}
            {isAdmin(actor.role) && (
              <div>
                <div className="label mb-1.5">{t('VIP статус')}</div>
                <VipForm userId={user.id} activeUntil={isVip(user.vipUntil, now) ? user.vipUntil!.toISOString() : null} today={now.toISOString()} />
              </div>
            )}
            {isAdmin(actor.role) && (
              <div>
                <div className="label mb-1.5">{t('Достъп до профила (имейл {0})', user.emailVerifiedAt ? t('потвърден') : t('непотвърден'))}</div>
                {canBan(actor.role, actor.id, user.role, user.id) && <ResetLinkButton userId={user.id} />}
                {!user.emailVerifiedAt && (
                  <div className="mt-2"><ActionButton endpoint="/api/admin/action" action={{ type: 'verifyUserEmail', userId: user.id }} className="btn-ghost px-3 py-1.5 text-xs" confirm={user.id === actor.id ? t('Да маркираме ли твоя имейл като потвърден?') : t('Да маркираме ли имейла като потвърден? Направи го само ако играчът докаже, че адресът е негов.')}>{t('Потвърди имейла ръчно')}</ActionButton></div>
                )}
              </div>
            )}
            {isAdmin(actor.role) && company && (
              <div>
                <div className="label mb-1.5">{t('Корекция на баланса')}</div>
                <AdjustBalanceForm userId={user.id} />
              </div>
            )}
          </div>
        </Card>
      </div>
      <Card title={t('Одит за този потребител')}>
        <ul className="space-y-1.5 text-sm">
          {detail.audit.map((a) => <li key={a.id} className="flex justify-between gap-3"><span>{describeAudit(a, null, user.username)}</span><span className="shrink-0 text-xs text-mist-400">{dateTime(a.createdAt)}</span></li>)}
          {detail.audit.length === 0 && <li className="text-mist-400">{t('Няма записи.')}</li>}
        </ul>
      </Card>
    </div>
  );
}
