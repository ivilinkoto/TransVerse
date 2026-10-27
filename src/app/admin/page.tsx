import { Activity, LifeBuoy, Route, Truck, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { Badge, Card, PageHeader, Stat } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { SelectAction } from '@/components/ui/SelectAction';
import { SEASON_IDS, SEASONS, activeSeason } from '@/lib/game/seasonal';
import { seasonMode } from '@/server/seasonal';
import { dateTime, int } from '@/lib/format';
import { adminStats, auditLog, newPlayerFunnel } from '@/server/admin';
import { adminContext } from '@/server/admin-context';
import { describeAudit } from '@/server/audit-format';
import { isAdmin } from '@/server/auth/roles';
import { staffTicketList, TICKET_STATUS } from '@/server/game/support';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import { BroadcastForm } from '@/components/admin/BroadcastForm';
import { storedBroadcast } from '@/server/broadcast';

export default async function AdminDashboard() {
  await initLocale();
  const { db, user, now } = await adminContext();
  const mode = await seasonMode(db);
  const season = activeSeason(new Date(), mode);
  const [stats, tickets, audit, funnel, broadcast] = await Promise.all([adminStats(db), staffTicketList(db, 'open'), isAdmin(user.role) ? auditLog(db, 8) : Promise.resolve([]), newPlayerFunnel(db), storedBroadcast(db)]);
  const live = broadcast && new Date(broadcast.until) > now ? broadcast : null;
  const pct = (n: number) => (funnel.week ? Math.round((n / funnel.week) * 100) : 0);
  return (
    <div className="space-y-6">
      <PageHeader title={t('Админ панел')} subtitle={t('Състояние на света и на общността.')} actions={isAdmin(user.role) ? <ActionButton endpoint="/api/admin/action" action={{ type: 'replenishMarket' }}>{t('Попълни пазара сега')}</ActionButton> : undefined} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={t('Потребители')} value={int(stats.users)} icon={Users} tone="cyan" hint={t('+{0} за 24 ч · {1} влизания', stats.newUsers, stats.online)} />
        <Stat label={t('Компании / шофьори')} value={`${stats.companies} / ${stats.independents}`} icon={UserPlus} tone="prestige" hint={t('основани компании / самостоятелни')} />
        <Stat label={t('Доставки')} value={int(stats.activeDeliveries)} icon={Truck} tone="gold" hint={t('активни · {0} завършени за 24 ч', stats.deliveries24h)} />
        <Stat label={t('Пазар и маршрути')} value={int(stats.openContracts)} icon={Route} tone="profit" hint={t('отворени поръчки · {0} маршрута ({1} приблизителни)', stats.routes, stats.approxRoutes)} />
      </div>
      <Card title={t('Нови играчи (7 дни)')} actions={<span className="text-xs text-mist-400">{t('днес: {0}', funnel.today)}</span>}>
        <div className="grid gap-3 sm:grid-cols-5">
          {[
            { label: t('Регистрирани'), n: funnel.week, share: 100 },
            { label: t('Първи курс'), n: funnel.first, share: pct(funnel.first) },
            { label: t('5+ курса'), n: funnel.five, share: pct(funnel.five) },
            { label: t('Върнали се на следващия ден'), n: funnel.back, share: pct(funnel.back) },
            { label: t('В компания'), n: funnel.company, share: pct(funnel.company) },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-asphalt-700 p-3">
              <div className="text-xs text-mist-400">{s.label}</div>
              <div className="num mt-1 font-display text-xl font-bold">{int(s.n)} <span className="text-sm font-normal text-mist-400">{s.share}%</span></div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-asphalt-700"><div className="h-full rounded-full bg-cyan-glow" style={{ width: `${s.share}%` }} /></div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-mist-400">{t('Където процентът пада рязко, там новите играчи се отказват. Сигналите за ботове са в „Икономика“ → „Регистрация и вход“.')}</p>
      </Card>
      {isAdmin(user.role) && (
        <Card title={t('Съобщение до всички играчи')} actions={<span className="text-xs text-mist-400">{!live ? t('няма') : new Date(live.startsAt) > now ? t('планирано: {0} – {1}', dateTime(live.startsAt), dateTime(live.until)) : t('показва се до {0}', dateTime(live.until))}{live?.discord ? t(' · и в Discord') : ''}</span>}>
          <p className="mb-3 text-sm text-mist-300">{t('Лента най-горе на всяка страница на играта — за поддръжка, ивент или известен проблем. Играчът може да я скрие; новото съобщение се показва отново. Текстът се показва както е написан (не се превежда).')}</p>
          <BroadcastForm current={live ? { text: live.text, tone: live.tone, until: live.until } : null} />
        </Card>
      )}
      {isAdmin(user.role) && (
        <Card title={t('Празнична тема')} actions={<span className="text-xs text-mist-400">{season ? t('сега: {0}', SEASONS[season].label) : t('сега: основен дизайн')}</span>}>
          <div className="grid gap-3 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] sm:items-center">
            <p className="text-mist-300">{t('„Автоматично“ включва празника по дати (')}{Object.values(SEASONS).map((s) => `${s.label} ${s.from.split('-').reverse().join('.')}–${s.to.split('-').reverse().join('.')}`).join(', ')}{t(') и сам връща основния дизайн след него. Играчите могат да изключат украсата от Настройки.')}</p>
            <SelectAction
              endpoint="/api/admin/action"
              label={t('Запази')}
              ariaLabel={t('Празнична тема')}
              value={mode.mode === 'on' ? `on:${mode.season}` : mode.mode}
              options={[{ value: 'auto', label: t('Автоматично по дати') }, ...SEASON_IDS.map((id) => ({ value: `on:${id}`, label: t('Винаги: {0}', SEASONS[id].label) })), { value: 'off', label: t('Изключена (основен дизайн)') }]}
              action={{ type: 'seasonMode' }}
              field="value"
            />
          </div>
        </Card>
      )}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title={t('Отворени запитвания ({0})', stats.openTickets)} actions={<LifeBuoy className="h-4 w-4 text-amber-sig" />}>
          {tickets.length === 0 ? <p className="text-sm text-mist-400">{t('Няма чакащи запитвания.')}</p> : (
            <ul className="divide-y divide-asphalt-800 text-sm">
              {tickets.slice(0, 8).map(({ ticket, username }) => (
                <li key={ticket.id}><Link href={`/admin/tickets/${ticket.id}`} className="flex justify-between gap-3 py-2.5 hover:text-white"><span className="truncate">{tx(ticket.subject)} <span className="text-mist-400">· {username}</span></span><Badge tone="gold">{tx(TICKET_STATUS[ticket.status as keyof typeof TICKET_STATUS])}</Badge></Link></li>
              ))}
            </ul>
          )}
        </Card>
        {isAdmin(user.role) && (
          <Card title={t('Последни административни действия')} actions={<Activity className="h-4 w-4 text-prestige" />}>
            <ul className="space-y-2 text-sm">
              {audit.map((a) => (
                <li key={a.entry.id} className="flex justify-between gap-3">
                  <span className="min-w-0"><span className="font-semibold">{tx(a.actor)}</span> <span className="text-mist-300">{describeAudit(a.entry, a.actor, a.target)}</span></span>
                  <span className="shrink-0 text-xs text-mist-400">{dateTime(a.entry.createdAt)}</span>
                </li>
              ))}
              {audit.length === 0 && <li className="text-mist-400">{t('Няма действия.')}</li>}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
