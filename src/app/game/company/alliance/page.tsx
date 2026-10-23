import { and, eq, gt } from 'drizzle-orm';
import { GraduationCap, Handshake, Shield, Warehouse } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { Badge, Card, Meter, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { SelectAction } from '@/components/ui/SelectAction';
import { TextAction } from '@/components/ui/TextAction';
import { AllianceListForm } from '@/components/game/AllianceListForm';
import { CARGO, type CargoType } from '@/lib/game/cargo';
import { ALLIANCE_MARKET } from '@/lib/game/community';
import { allianceMarketView } from '@/server/game/alliance-market';
import { date, dec, money } from '@/lib/format';
import { ACADEMY, ALLIANCE, ALLIANCE_HALL, COMPANY_CONTRACT } from '@/lib/game/alliances';
import { allianceInvites, alliances, companyMembers, users } from '@/server/db/schema';
import { academyOf, allianceHall, allianceOf, allianceWeekView, contractsOf } from '@/server/game/alliances';
import { gameContext } from '@/server/game/context';
import { can, membershipOf } from '@/server/game/membership';

export const metadata = { title: 'Съюз и партньори' };

export default async function AlliancePage() {
  const { db, user, now, features } = await gameContext();
  if (!features.alliances && !features.company_contracts && !features.academy) notFound();
  const m = await membershipOf(db, user.id);
  if (!m) redirect('/game/company');
  const manage = can(m.rank, 'manage_settings');
  const alliance = features.alliances ? await allianceOf(db, m.company.id) : null;
  const [week, invites, contracts, academy, members] = await Promise.all([
    alliance ? allianceWeekView(db, alliance.id, alliance.members.length, now) : null,
    features.alliances && !alliance ? db.select({ id: allianceInvites.id, name: alliances.name }).from(allianceInvites).innerJoin(alliances, eq(alliances.id, allianceInvites.allianceId)).where(and(eq(allianceInvites.organizationId, m.company.id), eq(allianceInvites.status, 'pending'), gt(allianceInvites.expiresAt, now))) : [],
    features.company_contracts ? contractsOf(db, m.company.id) : null,
    features.academy ? academyOf(db, m.company.id) : [],
    features.academy ? db.select({ id: users.id, username: users.username, level: users.level }).from(companyMembers).innerJoin(users, eq(users.id, companyMembers.userId)).where(eq(companyMembers.companyId, m.company.id)) : [],
  ]);
  const market = alliance && features.alliance_market ? await allianceMarketView(db, user.id, now) : null;
  const hall = alliance && features.alliance_hall ? await allianceHall(db, alliance.id) : null;
  const perks = [
    features.alliance_convoy && 'конвой с членовете на всички компании в съюза',
    features.alliance_help && 'пътна помощ от съюзници (и вие на тях)',
    features.alliance_fuel && 'горивна карта: отстъпката на бензиностанциите на всички съюзни компании',
    features.alliance_map && 'базите на съюза на картата',
  ].filter(Boolean) as string[];
  const newMember = m.member.joinedAt.getTime() + ACADEMY.joinedDays * 86_400_000 > now.getTime();
  const enrolled = academy.find((s) => s.userId === user.id);
  return (
    <div className="space-y-6">
      <PageHeader title="Съюз и партньори" subtitle="Съюзи с други компании, договори за превоз и фирмената академия (игрови данни)." />

      {features.alliances && (
        <Card title={<span className="flex items-center gap-2"><Shield className="h-5 w-5 text-cyan-glow" />Съюз</span>}>
          {alliance ? (
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><div className="font-display text-xl font-bold">{alliance.name}</div><div className="text-mist-400">{alliance.members.map((x) => `${x.name}${x.tag ? ` [${x.tag}]` : ''}`).join(' · ')}</div></div>
                {manage && (
                  <span className="flex flex-wrap gap-2">
                    {alliance.leaderOrgId === m.company.id && <ActionButton action={{ type: 'dissolveAlliance' }} className="btn-ghost text-loss" confirm="Да разпуснем ли съюза? Изчезва за всички компании в него, заедно с чата.">Разпусни съюза</ActionButton>}
                    <ActionButton action={{ type: 'leaveAlliance' }} className="btn-ghost text-loss" confirm="Компанията да напусне съюза?">Напусни съюза</ActionButton>
                  </span>
                )}
              </div>
              {week && (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-asphalt-700 p-3">
                    <div className="flex justify-between"><span>Седмична цел</span><span className="num">{dec(week.tons)} / {dec(week.targetTons)} т</span></div>
                    <Meter value={(week.tons / week.targetTons) * 100} tone="gold" className="mt-2" />
                    <p className="mt-1 text-xs text-mist-400">Изпълнена — всяка компания получава {money(ALLIANCE.goalRewardCents)} в касата.</p>
                  </div>
                  <div className="rounded-xl border border-asphalt-700 p-3">
                    <div>Битка на съюзите</div>
                    {week.rival ? <p className="mt-1">Срещу <b>{week.rival.name}</b>: <span className="num">{dec(week.tons)} т</span> : <span className="num">{dec(week.rival.tons)} т</span></p> : <p className="mt-1 text-mist-400">Противникът ще бъде избран скоро (нужни са поне два съюза).</p>}
                    <p className="mt-1 text-xs text-mist-400">Победителят — {money(ALLIANCE.battleRewardCents)} за всяка компания.</p>
                  </div>
                </div>
              )}
              {hall && (
                <div className="rounded-xl border border-asphalt-700 p-3">
                  <div className="flex justify-between"><span>🏛 Съюзна база в {hall.city} · ниво {hall.level}</span>{hall.next ? <span className="num">{dec(hall.tons)} / {hall.next} т</span> : <span className="text-profit">максимално ниво</span>}</div>
                  {hall.next && <Meter value={(hall.tons / hall.next) * 100} tone="violet" className="mt-2" />}
                  <p className="mt-1 text-xs text-mist-400">Карайте строителни материали (палети и стомана) до {hall.city} — всеки курс на член на съюза се брои. Всяко ниво дава +{Math.round(ALLIANCE_HALL.bonusPerLevel * 100)} % към заплащането на всички членове{hall.level ? ` (сега +${Math.round(hall.bonusShare * 100)} %)` : ''}.</p>
                </div>
              )}
              {perks.length > 0 && <p className="text-xs text-mist-300">Заедно в съюза: {perks.join(' · ')}.</p>}
              {features.alliance_discord && manage && alliance.leaderOrgId === m.company.id && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span>Канал на съюза в Discord: <b>{alliance.discordChannel ? 'включен' : 'изключен'}</b></span>
                  <ActionButton action={{ type: 'allianceDiscord', on: !alliance.discordChannel }} className="btn-ghost px-3 py-1 text-xs">{alliance.discordChannel ? 'Изключи' : 'Включи'}</ActionButton>
                </div>
              )}
              {manage && alliance.leaderOrgId === m.company.id && alliance.members.length < ALLIANCE.maxCompanies && <TextAction label="Покани" action={{ type: 'inviteToAlliance' }} field="target" placeholder="Таг или име на компания" ariaLabel="Компания за съюза" />}
              <p className="text-sm text-mist-300">💬 Чатът на съюза е в плаващия чат — раздел „Съюз“, до „Глобален“ и „Компания“.</p>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <p className="text-mist-300">До {ALLIANCE.maxCompanies} компании в съюз — само по покана, която компанията трябва да приеме: общ чат, седмична цел ({ALLIANCE.goalTonsPerCompany} т на компания) и битка срещу друг съюз.</p>
              {invites.map((i) => (
                <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-asphalt-700 p-3">
                  <span>Покана от съюза <b>{i.name}</b></span>
                  {manage && <span className="flex gap-2"><ActionButton action={{ type: 'respondAllianceInvite', inviteId: i.id, accept: true }} className="btn-primary">Приеми</ActionButton><ActionButton action={{ type: 'respondAllianceInvite', inviteId: i.id, accept: false }}>Откажи</ActionButton></span>}
                </div>
              ))}
              {manage ? <TextAction label="Създай съюз" action={{ type: 'createAlliance' }} field="name" placeholder="Име на съюза" ariaLabel="Име на съюза" maxLength={ALLIANCE.nameMax} /> : <p className="text-xs text-mist-400">Съюз създава длъжност с право „Настройки“.</p>}
            </div>
          )}
        </Card>
      )}

      {market && (
        <Card title={<span className="flex items-center gap-2"><Warehouse className="h-5 w-5 text-cyan-glow" />Склад на съюза</span>}>
          <p className="text-sm text-mist-300">Продавай стока от складовете си на членовете на съюза — купува се в същия град, направо в склада на купувача (нужно му е депо там). Обявата е {ALLIANCE_MARKET.hours} ч; непродаденото се връща при теб. Игрови данни.</p>
          <div className="mt-3"><AllianceListForm stock={market.stock.map((s) => ({ ...s, label: CARGO[s.cargoType as CargoType]?.label ?? s.cargoType }))} /></div>
          <ul className="mt-3 divide-y divide-asphalt-800 text-sm">
            {market.listings.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><b>{l.tons} т</b> {(CARGO[l.cargoType as CargoType]?.label ?? l.cargoType).toLowerCase()} · {l.city} <span className="text-xs text-mist-400">· {l.seller} · {money(l.priceCents)} ({money(Math.round(l.priceCents / l.tons))}/т) · до {date(l.expiresAt)}</span></span>
                {l.mine ? <ActionButton action={{ type: 'withdrawAllianceListing', listingId: l.id }}>Свали</ActionButton> : l.canBuy ? <ActionButton action={{ type: 'buyAllianceListing', listingId: l.id }} className="btn-primary" confirm={`Да купиш ли ${l.tons} т за ${money(l.priceCents)}?`}>Купи</ActionButton> : <span className="text-xs text-mist-400">нужно е депо в {l.city}</span>}
              </li>
            ))}
            {!market.listings.length && <li className="py-2 text-mist-400">Още няма обяви.</li>}
          </ul>
        </Card>
      )}

      {contracts && (
        <Card title={<span className="flex items-center gap-2"><Handshake className="h-5 w-5 text-cyan-glow" />Договори за превоз</span>}>
          <p className="text-sm text-mist-300">Наемете друга компания за {COMPANY_CONTRACT.days} дни: нейните членове карат товарите на вашата фабрика и филиали, а вие ѝ плащате дял от всеки товар от касата. Превозвачите имат рейтинг.</p>
          <p className="mt-1 text-sm">Вашият рейтинг като превозвач: {contracts.rating ? <b>{'★'.repeat(Math.round(contracts.rating))} {dec(contracts.rating)}</b> : 'още няма'} {contracts.ratings ? <span className="text-xs text-mist-400">({contracts.ratings} оценки)</span> : null}</p>
          {manage && <div className="mt-3"><TextAction label="Предложи" action={{ type: 'offerCompanyContract' }} field="target" placeholder="Таг или име на компанията превозвач" ariaLabel="Компания превозвач" number={{ field: 'sharePct', label: '% дял', min: COMPANY_CONTRACT.minShare * 100, max: COMPANY_CONTRACT.maxShare * 100, value: 15 }} /></div>}
          <ul className="mt-3 divide-y divide-asphalt-800 text-sm">
            {contracts.list.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{c.mineAsClient ? <>Превозвач: <b>{c.hauler}</b></> : <>Клиент: <b>{c.client}</b></>} · {Math.round(c.share * 100)} % · <Badge tone={c.status === 'active' ? 'green' : c.status === 'pending' ? 'gold' : 'neutral'}>{c.status === 'active' ? `до ${date(c.endsAt!)}` : c.status === 'pending' ? 'чака отговор' : c.status === 'declined' ? 'отказан' : 'приключи'}</Badge> <span className="text-xs text-mist-400">{c.loads} товара · {money(c.paidCents)}</span></span>
                {manage && !c.mineAsClient && c.status === 'pending' && <span className="flex gap-2"><ActionButton action={{ type: 'respondCompanyContract', contractId: c.id, accept: true }} className="btn-primary">Приеми</ActionButton><ActionButton action={{ type: 'respondCompanyContract', contractId: c.id, accept: false }}>Откажи</ActionButton></span>}
                {manage && c.mineAsClient && c.status === 'done' && !c.rating && <SelectAction label="Оцени" ariaLabel="Оценка" value="" options={[{ value: '', label: '—' }, ...[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: '★'.repeat(n) }))]} action={{ type: 'rateCompanyContract', contractId: c.id }} field="stars" numeric />}
                {c.rating ? <span className="text-gold-400">{'★'.repeat(c.rating)}</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {features.academy && (
        <Card title={<span className="flex items-center gap-2"><GraduationCap className="h-5 w-5 text-cyan-glow" />Фирмена академия</span>}>
          <p className="text-sm text-mist-300">Новите членове (до {ACADEMY.joinedDays} дни в компанията) избират наставник от ниво {ACADEMY.mentorMinLevel}+ и минават {ACADEMY.courses} учебни курса — доставки навреме от поне {ACADEMY.minKm} км. Накрая: +{ACADEMY.studentXp} опит за ученика, {ACADEMY.mentorCoins} TC за наставника и {money(ACADEMY.treasuryCents)} за касата.</p>
          {newMember && !enrolled && (
            <div className="mt-3 max-w-md"><SelectAction label="Запиши се" ariaLabel="Наставник" value="" options={[{ value: '', label: '— избери наставник —' }, ...members.filter((x) => x.id !== user.id && x.level >= ACADEMY.mentorMinLevel).map((x) => ({ value: x.id, label: `${x.username} (ниво ${x.level})` }))]} action={{ type: 'enrolAcademy' }} field="mentorId" /></div>
          )}
          <ul className="mt-3 space-y-1.5 text-sm">
            {academy.map((s) => (
              <li key={s.id} className="flex justify-between gap-2"><span>{s.username} <span className="text-xs text-mist-400">· наставник {s.mentor}</span></span><span>{s.finishedAt ? <Badge tone="green">🎓 завърши</Badge> : `${s.courses} / ${ACADEMY.courses} курса`}</span></li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
