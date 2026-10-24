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
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Съюз и партньори') };
}

export default async function AlliancePage() {
  await initLocale();
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
    features.alliance_convoy && t('конвой с членовете на всички компании в съюза'),
    features.alliance_help && t('пътна помощ от съюзници (и вие на тях)'),
    features.alliance_fuel && t('горивна карта: отстъпката на бензиностанциите на всички съюзни компании'),
    features.alliance_map && t('базите на съюза на картата'),
  ].filter(Boolean) as string[];
  const newMember = m.member.joinedAt.getTime() + ACADEMY.joinedDays * 86_400_000 > now.getTime();
  const enrolled = academy.find((s) => s.userId === user.id);
  return (
    <div className="space-y-6">
      <PageHeader title={t('Съюз и партньори')} subtitle={t('Съюзи с други компании, договори за превоз и фирмената академия (игрови данни).')} />

      {features.alliances && (
        <Card title={<span className="flex items-center gap-2"><Shield className="h-5 w-5 text-cyan-glow" />{t('Съюз')}</span>}>
          {alliance ? (
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><div className="font-display text-xl font-bold">{tx(alliance.name)}</div><div className="text-mist-400">{alliance.members.map((x) => `${x.name}${x.tag ? ` [${x.tag}]` : ''}`).join(' · ')}</div></div>
                {manage && (
                  <span className="flex flex-wrap gap-2">
                    {alliance.leaderOrgId === m.company.id && <ActionButton action={{ type: 'dissolveAlliance' }} className="btn-ghost text-loss" confirm={t('Да разпуснем ли съюза? Изчезва за всички компании в него, заедно с чата.')}>{t('Разпусни съюза')}</ActionButton>}
                    <ActionButton action={{ type: 'leaveAlliance' }} className="btn-ghost text-loss" confirm={t('Компанията да напусне съюза?')}>{t('Напусни съюза')}</ActionButton>
                  </span>
                )}
              </div>
              {week && (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-asphalt-700 p-3">
                    <div className="flex justify-between"><span>{t('Седмична цел')}</span><span className="num">{t('{0} / {1} т', dec(week.tons), dec(week.targetTons))}</span></div>
                    <Meter value={(week.tons / week.targetTons) * 100} tone="gold" className="mt-2" />
                    <p className="mt-1 text-xs text-mist-400">{t('Изпълнена — всяка компания получава {0} в касата.', money(ALLIANCE.goalRewardCents))}</p>
                  </div>
                  <div className="rounded-xl border border-asphalt-700 p-3">
                    <div>{t('Битка на съюзите')}</div>
                    {week.rival ? <p className="mt-1">{t('Срещу')}{' '}<b>{tx(week.rival.name)}</b>: <span className="num">{t('{0} т', dec(week.tons))}</span> : <span className="num">{t('{0} т', dec(week.rival.tons))}</span></p> : <p className="mt-1 text-mist-400">{t('Противникът ще бъде избран скоро (нужни са поне два съюза).')}</p>}
                    <p className="mt-1 text-xs text-mist-400">{t('Победителят — {0} за всяка компания.', money(ALLIANCE.battleRewardCents))}</p>
                  </div>
                </div>
              )}
              {hall && (
                <div className="rounded-xl border border-asphalt-700 p-3">
                  <div className="flex justify-between"><span>{t('🏛 Съюзна база в {0} · ниво {1}', hall.city, hall.level)}</span>{hall.next ? <span className="num">{t('{0} / {1} т', dec(hall.tons), hall.next)}</span> : <span className="text-profit">{t('максимално ниво')}</span>}</div>
                  {hall.next && <Meter value={(hall.tons / hall.next) * 100} tone="violet" className="mt-2" />}
                  <p className="mt-1 text-xs text-mist-400">{t('Карайте строителни материали (палети и стомана) до {0} — всеки курс на член на съюза се брои. Всяко ниво дава +{1} % към заплащането на всички членове{2}.', hall.city, Math.round(ALLIANCE_HALL.bonusPerLevel * 100), hall.level ? t(' (сега +{0} %)', Math.round(hall.bonusShare * 100)) : '')}</p>
                </div>
              )}
              {perks.length > 0 && <p className="text-xs text-mist-300">{t('Заедно в съюза: {0}.', perks.join(' · '))}</p>}
              {features.alliance_discord && manage && alliance.leaderOrgId === m.company.id && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span>{t('Канал на съюза в Discord:')}{' '}<b>{alliance.discordChannel ? t('включен') : t('изключен')}</b></span>
                  <ActionButton action={{ type: 'allianceDiscord', on: !alliance.discordChannel }} className="btn-ghost px-3 py-1 text-xs">{alliance.discordChannel ? t('Изключи') : t('Включи')}</ActionButton>
                </div>
              )}
              {manage && alliance.leaderOrgId === m.company.id && alliance.members.length < ALLIANCE.maxCompanies && <TextAction label={t('Покани')} action={{ type: 'inviteToAlliance' }} field="target" placeholder={t('Таг или име на компания')} ariaLabel={t('Компания за съюза')} />}
              <p className="text-sm text-mist-300">{t('💬 Чатът на съюза е в плаващия чат — раздел „Съюз“, до „Глобален“ и „Компания“.')}</p>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <p className="text-mist-300">{t('До {0} компании в съюз — само по покана, която компанията трябва да приеме: общ чат, седмична цел ({1} т на компания) и битка срещу друг съюз.', ALLIANCE.maxCompanies, ALLIANCE.goalTonsPerCompany)}</p>
              {invites.map((i) => (
                <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-asphalt-700 p-3">
                  <span>{t('Покана от съюза')}{' '}<b>{tx(i.name)}</b></span>
                  {manage && <span className="flex gap-2"><ActionButton action={{ type: 'respondAllianceInvite', inviteId: i.id, accept: true }} className="btn-primary">{t('Приеми')}</ActionButton><ActionButton action={{ type: 'respondAllianceInvite', inviteId: i.id, accept: false }}>{t('Откажи')}</ActionButton></span>}
                </div>
              ))}
              {manage ? <TextAction label={t('Създай съюз')} action={{ type: 'createAlliance' }} field="name" placeholder={t('Име на съюза')} ariaLabel={t('Име на съюза')} maxLength={ALLIANCE.nameMax} /> : <p className="text-xs text-mist-400">{t('Съюз създава длъжност с право „Настройки“.')}</p>}
            </div>
          )}
        </Card>
      )}

      {market && (
        <Card title={<span className="flex items-center gap-2"><Warehouse className="h-5 w-5 text-cyan-glow" />{t('Склад на съюза')}</span>}>
          <p className="text-sm text-mist-300">{t('Продавай стока от складовете си на членовете на съюза — купува се в същия град, направо в склада на купувача (нужно му е депо там). Обявата е {0} ч; непродаденото се връща при теб. Игрови данни.', ALLIANCE_MARKET.hours)}</p>
          <div className="mt-3"><AllianceListForm stock={market.stock.map((s) => ({ ...s, label: CARGO[s.cargoType as CargoType]?.label ?? s.cargoType }))} /></div>
          <ul className="mt-3 divide-y divide-asphalt-800 text-sm">
            {market.listings.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><b>{t('{0} т', l.tons)}</b> {(CARGO[l.cargoType as CargoType]?.label ?? l.cargoType).toLowerCase()} · {tx(l.city)} <span className="text-xs text-mist-400">{t('· {0} · {1} ({2}/т) · до {3}', l.seller, money(l.priceCents), money(Math.round(l.priceCents / l.tons)), date(l.expiresAt))}</span></span>
                {l.mine ? <ActionButton action={{ type: 'withdrawAllianceListing', listingId: l.id }}>{t('Свали')}</ActionButton> : l.canBuy ? <ActionButton action={{ type: 'buyAllianceListing', listingId: l.id }} className="btn-primary" confirm={t('Да купиш ли {0} т за {1}?', l.tons, money(l.priceCents))}>{t('Купи')}</ActionButton> : <span className="text-xs text-mist-400">{t('нужно е депо в {0}', l.city)}</span>}
              </li>
            ))}
            {!market.listings.length && <li className="py-2 text-mist-400">{t('Още няма обяви.')}</li>}
          </ul>
        </Card>
      )}

      {contracts && (
        <Card title={<span className="flex items-center gap-2"><Handshake className="h-5 w-5 text-cyan-glow" />{t('Договори за превоз')}</span>}>
          <p className="text-sm text-mist-300">{t('Наемете друга компания за {0} дни: нейните членове карат товарите на вашата фабрика и филиали, а вие ѝ плащате дял от всеки товар от касата. Превозвачите имат рейтинг.', COMPANY_CONTRACT.days)}</p>
          <p className="mt-1 text-sm">{t('Вашият рейтинг като превозвач:')}{' '}{contracts.rating ? <b>{'★'.repeat(Math.round(contracts.rating))} {dec(contracts.rating)}</b> : t('още няма')} {contracts.ratings ? <span className="text-xs text-mist-400">{t('({0} оценки)', contracts.ratings)}</span> : null}</p>
          {manage && <div className="mt-3"><TextAction label={t('Предложи')} action={{ type: 'offerCompanyContract' }} field="target" placeholder={t('Таг или име на компанията превозвач')} ariaLabel={t('Компания превозвач')} number={{ field: 'sharePct', label: t('% дял'), min: COMPANY_CONTRACT.minShare * 100, max: COMPANY_CONTRACT.maxShare * 100, value: 15 }} /></div>}
          <ul className="mt-3 divide-y divide-asphalt-800 text-sm">
            {contracts.list.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{c.mineAsClient ? <>{t('Превозвач:')}{' '}<b>{tx(c.hauler)}</b></> : <>{t('Клиент:')}{' '}<b>{tx(c.client)}</b></>} · {Math.round(c.share * 100)} % · <Badge tone={c.status === 'active' ? 'green' : c.status === 'pending' ? 'gold' : 'neutral'}>{c.status === 'active' ? t('до {0}', date(c.endsAt!)) : c.status === 'pending' ? t('чака отговор') : c.status === 'declined' ? t('отказан') : t('приключи')}</Badge> <span className="text-xs text-mist-400">{t('{0} товара · {1}', c.loads, money(c.paidCents))}</span></span>
                {manage && !c.mineAsClient && c.status === 'pending' && <span className="flex gap-2"><ActionButton action={{ type: 'respondCompanyContract', contractId: c.id, accept: true }} className="btn-primary">{t('Приеми')}</ActionButton><ActionButton action={{ type: 'respondCompanyContract', contractId: c.id, accept: false }}>{t('Откажи')}</ActionButton></span>}
                {manage && c.mineAsClient && c.status === 'done' && !c.rating && <SelectAction label={t('Оцени')} ariaLabel={t('Оценка')} value="" options={[{ value: '', label: '—' }, ...[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: '★'.repeat(n) }))]} action={{ type: 'rateCompanyContract', contractId: c.id }} field="stars" numeric />}
                {c.rating ? <span className="text-gold-400">{'★'.repeat(c.rating)}</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {features.academy && (
        <Card title={<span className="flex items-center gap-2"><GraduationCap className="h-5 w-5 text-cyan-glow" />{t('Фирмена академия')}</span>}>
          <p className="text-sm text-mist-300">{t('Новите членове (до {0} дни в компанията) избират наставник от ниво {1}+ и минават {2} учебни курса — доставки навреме от поне {3} км. Накрая: +{4} опит за ученика, {5} TC за наставника и {6} за касата.', ACADEMY.joinedDays, ACADEMY.mentorMinLevel, ACADEMY.courses, ACADEMY.minKm, ACADEMY.studentXp, ACADEMY.mentorCoins, money(ACADEMY.treasuryCents))}</p>
          {newMember && !enrolled && (
            <div className="mt-3 max-w-md"><SelectAction label={t('Запиши се')} ariaLabel={t('Наставник')} value="" options={[{ value: '', label: t('— избери наставник —') }, ...members.filter((x) => x.id !== user.id && x.level >= ACADEMY.mentorMinLevel).map((x) => ({ value: x.id, label: t('{0} (ниво {1})', x.username, x.level) }))]} action={{ type: 'enrolAcademy' }} field="mentorId" /></div>
          )}
          <ul className="mt-3 space-y-1.5 text-sm">
            {academy.map((s) => (
              <li key={s.id} className="flex justify-between gap-2"><span>{tx(s.username)} <span className="text-xs text-mist-400">{t('· наставник {0}', s.mentor)}</span></span><span>{s.finishedAt ? <Badge tone="green">{t('🎓 завърши')}</Badge> : t('{0} / {1} курса', s.courses, ACADEMY.courses)}</span></li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
