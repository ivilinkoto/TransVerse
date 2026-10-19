import { PlayerName } from '@/components/game/PlayerName';
import { isOnline, lastSeenLabel } from '@/lib/game/social';
import { isVip } from '@/lib/game/vip';
import { redirect } from 'next/navigation';
import { Badge, Card, Table } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { SelectAction } from '@/components/ui/SelectAction';
import { date, int, money } from '@/lib/format';
import { gameContext } from '@/server/game/context';
import { can, companyHub, companyMembersView, companyRanksView } from '@/server/game/membership';
import { bonusesLast24h, bonusRoomCents } from '@/server/game/bonuses';
import { BonusButton } from '@/components/company/BonusButton';
import { BONUS_RULES } from '@/lib/game/company';

export const metadata = { title: 'Членове на компанията' };

export default async function MembersPage() {
  const { db, user, now, features } = await gameContext();
  const hub = await companyHub(db, user.id);
  if (!hub) redirect('/game/company');
  const [members, ranks] = await Promise.all([companyMembersView(db, hub.company.id), companyRanksView(db, hub.company.id)]);
  const manage = can(hub.rank, 'manage_members');
  const recruit = can(hub.rank, 'recruit');
  // Company roles (v1.2): bonuses from the treasury.
  const bonuses = features.company_roles && can(hub.rank, 'pay_bonuses');
  const bonusRoom = bonuses ? bonusRoomCents(hub.company.treasuryCents, await bonusesLast24h(db, hub.company.id, now)) : 0;
  const assignable = ranks.filter((r) => !r.isOwner && r.priority > hub.rank.priority);
  return (
    <div className="space-y-6">
      {recruit && (
        <Card title={`Кандидатури (${hub.pending.length})`}>
          {hub.pending.length === 0 ? (
            <p className="text-sm text-mist-400">Няма чакащи кандидатури.</p>
          ) : (
            <ul className="space-y-3">
              {hub.pending.map((a) => (
                <li key={a.application.id} className="rounded-xl border border-asphalt-700 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{a.username} <span className="text-sm font-normal text-mist-400">· ниво {a.level} · {date(a.application.createdAt)}</span></span>
                    <span className="flex gap-2">
                      <ActionButton action={{ type: 'decideApplication', applicationId: a.application.id, accept: true }} className="btn-primary px-3 py-1.5 text-sm">Приеми</ActionButton>
                      <ActionButton action={{ type: 'decideApplication', applicationId: a.application.id, accept: false }} className="btn-ghost px-3 py-1.5 text-sm">Откажи</ActionButton>
                    </span>
                  </div>
                  {a.application.message && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-mist-300">{a.application.message}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {bonuses && (
        <p className="text-sm text-mist-400">
          Премии от касата: до {money(BONUS_RULES.maxCents)} на член веднъж на {BONUS_RULES.perMemberHours} часа, за членове от поне {BONUS_RULES.minMemberDays} дни. За 24 часа компанията дава до {Math.round(BONUS_RULES.companyDailyShare * 100)} % от касата (най-много {money(BONUS_RULES.companyDailyMaxCents)}). Днес остават {money(bonusRoom)}. Всяка премия се вижда в историята на касата.
        </p>
      )}
      <Card title="Членове">
        <Table head={['Играч', 'Длъжност', 'Ниво', 'Курсове', 'Вноски', 'Опит', 'От', '']}>
          {members.map((m) => {
            const manageable = manage && !m.rank.isOwner && m.rank.priority > hub.rank.priority;
            return (
              <tr key={m.userId} className={m.userId === user.id ? 'bg-volt-500/10' : ''}>
                <td className="px-3 py-2 font-semibold">
                  <span className="inline-flex items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${isOnline(m.lastSeenAt, now) ? 'bg-profit' : 'bg-asphalt-500'}`} title={lastSeenLabel(m.lastSeenAt, now)} />
                    <span>
                      <PlayerName name={m.username} role={m.role} vip={isVip(m.vipUntil, now)} />
                      <span className={`block text-[11px] font-normal ${isOnline(m.lastSeenAt, now) ? 'text-profit' : 'text-mist-400'}`}>{lastSeenLabel(m.lastSeenAt, now)}</span>
                    </span>
                  </span>
                </td>
                <td className="px-3 py-2">
                  {manageable && assignable.length > 1 ? (
                    <SelectAction label="OK" ariaLabel={`Длъжност на ${m.username}`} value={m.rank.id} options={assignable.map((r) => ({ value: r.id, label: r.name }))} action={{ type: 'setMemberRank', userId: m.userId }} field="rankId" />
                  ) : (
                    <Badge tone={m.rank.isOwner ? 'gold' : m.rank.permissions.length ? 'violet' : 'neutral'}>{m.rank.name}</Badge>
                  )}
                </td>
                <td className="num px-3 py-2">{m.level}</td>
                <td className="num px-3 py-2">{int(m.member.deliveries)}</td>
                <td className="num px-3 py-2 text-gold-400">{money(m.member.contributedCents)}</td>
                <td className="num px-3 py-2">{int(m.member.xpContributed)}</td>
                <td className="px-3 py-2 text-mist-400">{date(m.member.joinedAt)}</td>
                <td className="px-3 py-2 text-right">
                  {bonuses && m.userId !== user.id && <span className="mr-2 inline-block align-middle"><BonusButton userId={m.userId} username={m.username} roomCents={bonusRoom} /></span>}
                  {manageable && <ActionButton action={{ type: 'kickMember', userId: m.userId }} className="btn-ghost px-3 py-1.5 text-sm text-loss" confirm={`Да изключите ${m.username}?`}>Изключи</ActionButton>}
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </div>
  );
}
