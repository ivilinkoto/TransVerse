import { notFound } from 'next/navigation';
import { AdjustBalanceForm } from '@/components/admin/AdjustBalanceForm';
import { BanForm } from '@/components/admin/BanForm';
import { Badge, Card, PageHeader } from '@/components/ui';
import { SelectAction } from '@/components/ui/SelectAction';
import { date, dateTime, int, km, money } from '@/lib/format';
import { userDetail } from '@/server/admin';
import { adminContext } from '@/server/admin-context';
import { describeAudit } from '@/server/audit-format';
import { canBan, canChangeRole, isAdmin, ROLE_LABELS, type Role } from '@/server/auth/roles';
import { GameError } from '@/server/game/errors';

export const metadata = { title: 'Потребител' };

export default async function AdminUser({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { db, user: actor } = await adminContext();
  const detail = await userDetail(db, id).catch((e) => {
    if (e instanceof GameError) notFound();
    throw e;
  });
  const { user, company } = detail;
  const roleOptions = (['player', 'support', 'admin'] as const).filter((r) => r === user.role || canChangeRole(actor.role, actor.id, user.role, user.id, r));
  return (
    <div className="space-y-6">
      <PageHeader title={user.username} subtitle={<span className="inline-flex flex-wrap items-center gap-2">{user.email}<Badge tone={user.role === 'player' ? 'neutral' : 'violet'}>{ROLE_LABELS[user.role as Role]}</Badge>{user.bannedAt && <Badge tone="red">блокиран от {date(user.bannedAt)}</Badge>}</span>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Профил и игра">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="label">Регистрация</dt><dd className="mt-1">{dateTime(user.createdAt)}</dd></div>
            <div><dt className="label">Последен вход</dt><dd className="mt-1">{user.lastSeenAt ? dateTime(user.lastSeenAt) : '—'}</dd></div>
            <div><dt className="label">Ниво / опит</dt><dd className="num mt-1">{user.level} / {int(user.xp)}</dd></div>
            <div><dt className="label">Статус</dt><dd className="mt-1">{company?.kind === 'company' ? `Компания „${company.name}“` : 'Самостоятелен шофьор'}</dd></div>
            <div><dt className="label">Баланс</dt><dd className="num mt-1">{company ? money(company.balanceCents) : '—'}</dd></div>
            <div><dt className="label">Доставки</dt><dd className="num mt-1">{company?.deliveries ?? 0} · {km(company?.totalKm ?? 0)}</dd></div>
            {user.banReason && <div className="col-span-2"><dt className="label">Причина за блокиране</dt><dd className="mt-1">{user.banReason}</dd></div>}
          </dl>
        </Card>
        <Card title="Управление">
          <div className="space-y-5">
            <div>
              <div className="label mb-1.5">Длъжност</div>
              {roleOptions.length > 1 ? (
                <SelectAction endpoint="/api/admin/action" label="Запази" ariaLabel="Длъжност" value={user.role} options={roleOptions.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} action={{ type: 'setRole', userId: user.id }} field="role" />
              ) : (
                <p className="text-sm text-mist-400">{ROLE_LABELS[user.role as Role]} — нямате право да променяте тази длъжност.</p>
              )}
            </div>
            {canBan(actor.role, actor.id, user.role, user.id) && (
              <div>
                <div className="label mb-1.5">Достъп</div>
                <BanForm userId={user.id} banned={!!user.bannedAt} />
              </div>
            )}
            {isAdmin(actor.role) && company && (
              <div>
                <div className="label mb-1.5">Корекция на баланса</div>
                <AdjustBalanceForm userId={user.id} />
              </div>
            )}
          </div>
        </Card>
      </div>
      <Card title="Одит за този потребител">
        <ul className="space-y-1.5 text-sm">
          {detail.audit.map((a) => <li key={a.id} className="flex justify-between gap-3"><span>{describeAudit(a, null, user.username)}</span><span className="shrink-0 text-xs text-mist-400">{dateTime(a.createdAt)}</span></li>)}
          {detail.audit.length === 0 && <li className="text-mist-400">Няма записи.</li>}
        </ul>
      </Card>
    </div>
  );
}
