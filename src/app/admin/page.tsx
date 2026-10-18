import { Activity, LifeBuoy, Route, Truck, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { Badge, Card, PageHeader, Stat } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { SelectAction } from '@/components/ui/SelectAction';
import { SEASON_IDS, SEASONS, activeSeason } from '@/lib/game/seasonal';
import { seasonMode } from '@/server/seasonal';
import { dateTime, int } from '@/lib/format';
import { adminStats, auditLog } from '@/server/admin';
import { adminContext } from '@/server/admin-context';
import { describeAudit } from '@/server/audit-format';
import { isAdmin } from '@/server/auth/roles';
import { staffTicketList, TICKET_STATUS } from '@/server/game/support';

export default async function AdminDashboard() {
  const { db, user } = await adminContext();
  const mode = await seasonMode(db);
  const season = activeSeason(new Date(), mode);
  const [stats, tickets, audit] = await Promise.all([adminStats(db), staffTicketList(db, 'open'), isAdmin(user.role) ? auditLog(db, 8) : Promise.resolve([])]);
  return (
    <div className="space-y-6">
      <PageHeader title="Админ панел" subtitle="Състояние на света и на общността." actions={isAdmin(user.role) ? <ActionButton endpoint="/api/admin/action" action={{ type: 'replenishMarket' }}>Попълни пазара сега</ActionButton> : undefined} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Потребители" value={int(stats.users)} icon={Users} tone="cyan" hint={`+${stats.newUsers} за 24 ч · ${stats.online} влизания`} />
        <Stat label="Компании / шофьори" value={`${stats.companies} / ${stats.independents}`} icon={UserPlus} tone="prestige" hint="основани компании / самостоятелни" />
        <Stat label="Доставки" value={int(stats.activeDeliveries)} icon={Truck} tone="gold" hint={`активни · ${stats.deliveries24h} завършени за 24 ч`} />
        <Stat label="Пазар и маршрути" value={int(stats.openContracts)} icon={Route} tone="profit" hint={`отворени поръчки · ${stats.routes} маршрута (${stats.approxRoutes} приблизителни)`} />
      </div>
      {isAdmin(user.role) && (
        <Card title="Празнична тема" actions={<span className="text-xs text-mist-400">{season ? `сега: ${SEASONS[season].label}` : 'сега: основен дизайн'}</span>}>
          <div className="grid gap-3 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] sm:items-center">
            <p className="text-mist-300">„Автоматично“ включва празника по дати ({Object.values(SEASONS).map((s) => `${s.label} ${s.from.split('-').reverse().join('.')}–${s.to.split('-').reverse().join('.')}`).join(', ')}) и сам връща основния дизайн след него. Играчите могат да изключат украсата от Настройки.</p>
            <SelectAction
              endpoint="/api/admin/action"
              label="Запази"
              ariaLabel="Празнична тема"
              value={mode.mode === 'on' ? `on:${mode.season}` : mode.mode}
              options={[{ value: 'auto', label: 'Автоматично по дати' }, ...SEASON_IDS.map((id) => ({ value: `on:${id}`, label: `Винаги: ${SEASONS[id].label}` })), { value: 'off', label: 'Изключена (основен дизайн)' }]}
              action={{ type: 'seasonMode' }}
              field="value"
            />
          </div>
        </Card>
      )}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title={`Отворени запитвания (${stats.openTickets})`} actions={<LifeBuoy className="h-4 w-4 text-amber-sig" />}>
          {tickets.length === 0 ? <p className="text-sm text-mist-400">Няма чакащи запитвания.</p> : (
            <ul className="divide-y divide-asphalt-800 text-sm">
              {tickets.slice(0, 8).map(({ ticket, username }) => (
                <li key={ticket.id}><Link href={`/admin/tickets/${ticket.id}`} className="flex justify-between gap-3 py-2.5 hover:text-white"><span className="truncate">{ticket.subject} <span className="text-mist-400">· {username}</span></span><Badge tone="gold">{TICKET_STATUS[ticket.status as keyof typeof TICKET_STATUS]}</Badge></Link></li>
              ))}
            </ul>
          )}
        </Card>
        {isAdmin(user.role) && (
          <Card title="Последни административни действия" actions={<Activity className="h-4 w-4 text-prestige" />}>
            <ul className="space-y-2 text-sm">
              {audit.map((a) => (
                <li key={a.entry.id} className="flex justify-between gap-3">
                  <span className="min-w-0"><span className="font-semibold">{a.actor}</span> <span className="text-mist-300">{describeAudit(a.entry, a.actor, a.target)}</span></span>
                  <span className="shrink-0 text-xs text-mist-400">{dateTime(a.entry.createdAt)}</span>
                </li>
              ))}
              {audit.length === 0 && <li className="text-mist-400">Няма действия.</li>}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
