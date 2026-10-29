import { PlayerName } from '@/components/game/PlayerName';
import { PlotScene, viewFor } from '@/components/company/plot/scene';
import { isChristmas } from '@/lib/game/christmas';
import { isNight, plotWeather } from '@/lib/game/ambience';
import { Showcase } from '@/components/company/plot/Showcase';
import { companyShowcase } from '@/server/game/base-life';
import { isWinter } from '@/lib/game/winter';
import { ActionButton } from '@/components/ui/ActionButton';
import { publicPlot } from '@/server/game/plot';
import { isVip } from '@/lib/game/vip';
import { Building, Building2, Landmark, ScrollText } from 'lucide-react';
import { VehicleIllustration } from '@/components/vehicles/VehicleIllustration';
import { LEGEND, legendTier } from '@/lib/game/heritage';
import { SPECIALIZATIONS, type Specialization } from '@/lib/game/specialization';
import { museumOf } from '@/server/game/heritage';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { CompanyBrand } from '@/components/company/CompanyBrand';
import { JoinCompanyForm } from '@/components/company/forms';
import { Badge, Card, Table } from '@/components/ui';
import { date, int, money } from '@/lib/format';
import { COMPANY_UPGRADES, memberBonuses, memberCapacity, RECRUITMENT, type UpgradeLevels } from '@/lib/game/company';
import { companyHistory } from '@/server/game/company-life';
import { companyShadeOf } from '@/server/game/smuggling';
import { INTERNS } from '@/lib/game/company-life';
import { gameContext } from '@/server/game/context';
import { CompanyLicences } from '@/components/company/CompanyLicences';
import { CompanyHighlights } from '@/components/company/CompanyHighlights';
import { companyHighlights } from '@/server/game/company-profile';
import { isOnline } from '@/lib/game/social';
import { CompanySeason } from '@/components/company/CompanySeason';
import { CompanyMedals } from '@/components/company/CompanyMedals';
import { companyAchievementsOf, organizationMedals } from '@/server/game/medals';
import { companyLicenceSet } from '@/server/game/licences';
import { assetKinds, companyMembersView, membershipOf, myApplications, publicCompany } from '@/server/game/membership';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Компания') };
}

export default async function PublicCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  await initLocale();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { db, user, now, features } = await gameContext();
  const row = await publicCompany(db, id);
  if (!row) notFound();
  const c = row.company;
  const [assets, members, mine, applications, licences, highlights] = await Promise.all([assetKinds(db, c.id), companyMembersView(db, c.id), membershipOf(db, user.id), myApplications(db, user.id), companyLicenceSet(db, c.id), companyHighlights(db, c.id, now)]);
  const [base, exhibits] = await Promise.all([features.plot_guests ? publicPlot(db, c.id, user.id) : null, features.museum ? museumOf(db, c.id) : []]);
  const showcase = base && features.company_trophies ? await companyShowcase(db, c.id) : null;
  const history = features.company_history ? await companyHistory(db, c.id) : null;
  const [medals, companyAchievements] = await Promise.all([features.season_medals ? organizationMedals(db, c.id) : null, features.company_achievements ? companyAchievementsOf(db, c.id) : null]);
  const shade = features.smuggling ? await companyShadeOf(db, c.id) : null;
  const own = mine?.company.id === c.id;
  const capacity = memberCapacity(c.upgrades as UpgradeLevels);
  const bonuses = memberBonuses(c.upgrades as UpgradeLevels);
  const applied = applications.some((a) => a.application.companyId === c.id);
  const blocker =
    mine?.company.id === c.id ? t('Вие сте член на тази компания.')
    : mine ? t('Вече членувате в друга компания. Напуснете я, за да се присъедините тук.')
    : applied ? t('Кандидатурата ви чака одобрение.')
    : c.recruitment === 'closed' ? t('Компанията в момента не приема нови членове.')
    : user.level < c.minJoinLevel ? t('Компанията приема играчи от ниво {0} (вие сте ниво {1}).', c.minJoinLevel, user.level)
    : row.members >= capacity ? t('Компанията няма свободни места.')
    : null;
  return (
    <div className="space-y-6">
      <CompanyBrand company={c} hasLogo={assets.has('logo')} hasBanner={assets.has('banner')} subtitle={t('Собственик {0} · {1} / {2} членове · {3} курса на членовете', row.owner, int(row.members), capacity, int(row.deliveries))} actions={<Link href="/game/companies" className="btn-ghost">{t('← Всички компании')}</Link>} />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="min-w-0 space-y-6">
          {features.specializations && c.specialization && c.specialization in SPECIALIZATIONS && <div><Badge tone="violet">{t('🎯 Специализация: {0}', SPECIALIZATIONS[c.specialization as Specialization].label)}</Badge></div>}
          {shade && <div><Badge tone={shade === 'grey' ? 'neutral' : 'green'}>{shade === 'grey' ? t('🌫️ Сива компания — членовете ѝ карат и сенчести пратки') : t('✨ Чиста компания')}</Badge></div>}
          {(medals || companyAchievements) && <CompanyMedals medals={medals} achievements={companyAchievements} />}
          {features.company_profile && highlights && <CompanyHighlights h={highlights} />}
          {exhibits.length > 0 && (
            <Card title={<span className="inline-flex items-center gap-2"><Landmark className="h-4 w-4 text-mist-400" />{t('Музеят · {0} камиона', exhibits.length)}</span>}>
              <ul className="grid gap-3 sm:grid-cols-3">
                {exhibits.slice(0, 6).map((e) => (
                  <li key={e.id} className="text-xs text-mist-300">
                    <VehicleIllustration modelId={e.modelId} trailerModelId={null} color={e.color} livery={e.livery} className="h-auto w-full" />
                    <div className="mt-1 flex items-center justify-between gap-1"><span className="font-mono">{tx(e.plate)}</span><span className="num">{t('{0} км', int(e.odometerKm))}</span></div>
                    {legendTier(e.odometerKm) > 0 && <div className="text-gold-400">🏆 {tx(LEGEND[legendTier(e.odometerKm) - 1]!.title)}</div>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {base && base.buildings.some((b) => b.level > 0 || base.construction) && (
            <Card
              title={<span className="inline-flex items-center gap-2"><Building className="h-4 w-4 text-mist-400" />{t('Базата')}</span>}
              actions={mine?.company.id === c.id ? <Link href="/game/company/plot" className="text-xs text-cyan-glow hover:underline">{t('Към участъка →')}</Link> : <ActionButton action={{ type: 'likePlot', organizationId: c.id }} className={base.liked ? 'btn-primary px-3 py-1 text-xs' : 'btn-ghost px-3 py-1 text-xs'}>👍 {base.liked ? t('Харесано') : t('Браво')} · {tx(base.likes)}</ActionButton>}
            >
              <svg viewBox={(({ x, y, w, h }) => `${x} ${y} ${w} ${h}`)(viewFor(base.plotW))} className="block aspect-[1080/780] w-full rounded-xl" role="img" aria-label={t('Базата на „{0}“', c.name)}>
                <PlotScene
                  buildings={base.buildings}
                  construction={base.construction && { type: base.construction.type, status: base.construction.status, delivered: base.construction.delivered, progress: base.construction.startedAt && base.construction.endsAt ? Math.min(1, (now.getTime() - base.construction.startedAt.getTime()) / Math.max(1, base.construction.endsAt.getTime() - base.construction.startedAt.getTime())) : 0 }}
                  ghost={null}
                  selected={null}
                  parkedTrucks={Math.min(6, row.members + 1)}
                  incoming={0}
                  grid={false}
                  liveryColor={base.liveryColor}
                  plotW={base.plotW}
                  labelScale={1.4}
                  moving
                  night={features.plot_night && isNight(now)}
                  weather={features.plot_weather ? plotWeather(now) : null}
                  decor={base.decor}
                  season={!features.plot_season ? null : isChristmas(now) ? 'christmas' : isWinter(now) ? 'winter' : null}
                />
              </svg>
              {showcase && <div className="mt-3"><Showcase data={showcase} builderWeek={features.builder_week} /></div>}
              {base.likes > 0 && <p className="mt-2 text-xs text-mist-400">{t('{0} {1} тази база.', base.likes, base.likes === 1 ? t('играч харесва') : t('играчи харесват'))}</p>}
            </Card>
          )}
          <Card title={<span className="inline-flex items-center gap-2"><Building2 className="h-4 w-4 text-mist-400" />{t('За компанията')}</span>}>
            {c.description ? <p className="whitespace-pre-wrap break-words text-sm text-mist-200">{tx(c.description)}</p> : <p className="text-sm text-mist-400">{t('Няма описание.')}</p>}
          </Card>
          <Card title={<span className="inline-flex items-center gap-2"><ScrollText className="h-4 w-4 text-mist-400" />{t('Правила')}</span>}>
            {c.rules ? <p className="whitespace-pre-wrap break-words text-sm text-mist-200">{tx(c.rules)}</p> : <p className="text-sm text-mist-400">{t('Няма публикувани правила.')}</p>}
          </Card>
          <Card title={t('Членове')}>
            <Table head={[t('Играч'), t('Длъжност'), t('Ниво'), t('Курсове'), t('От')]}>
              {members.map((m) => (
                <tr key={m.userId}>
                  <td className="px-3 py-2 font-semibold"><span className="inline-flex items-center gap-2"><span className={`h-2 w-2 shrink-0 rounded-full ${isOnline(m.lastSeenAt, now) ? 'bg-profit' : 'bg-asphalt-500'}`} title={isOnline(m.lastSeenAt, now) ? t('В играта сега') : t('Не е в играта')} /><PlayerName name={m.username} role={m.role} vip={isVip(m.vipUntil, now)} /></span></td>
                  <td className="px-3 py-2"><Badge tone={m.rank.isOwner ? 'gold' : 'neutral'}>{tx(m.rank.name)}</Badge></td>
                  <td className="num px-3 py-2">{tx(m.level)}</td>
                  <td className="num px-3 py-2">{int(m.member.deliveries)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-mist-400">{date(m.member.joinedAt)}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
        <div className="min-w-0 space-y-6">
          <Card title={t('Присъединяване')} actions={<span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${row.members < capacity && c.recruitment !== 'closed' ? 'bg-profit/15 text-profit' : 'bg-asphalt-800 text-mist-400'}`}>{c.recruitment === 'closed' ? t('Не приема') : row.members < capacity ? t('Свободни места: {0}', capacity - row.members) : t('Няма места')}</span>}>
            <p className="mb-4 text-sm text-mist-300">{t('{0}. Вноска към компанията:', RECRUITMENT[c.recruitment as keyof typeof RECRUITMENT] ?? c.recruitment)}{' '}<span className="num font-semibold">{Math.round(c.contributionRate * 100)}%</span>{' '}{t('от възнаграждението за курс.')}</p>
            <JoinCompanyForm companyId={c.id} mode={c.recruitment === 'open' ? 'open' : 'application'} disabled={blocker} />
          </Card>
          {!own && (features.interns || (features.mergers && mine?.rank.isOwner)) && (
            <Card title={t('Сътрудничество')}>
              <div className="space-y-3 text-sm">
                {features.interns && (
                  <div>
                    <p className="mb-2 text-mist-300">{t('Стаж: {0} дни караш с +{1} % опит, а компанията-домакин печели опит от курсовете ти. Оставаш в своята компания.', INTERNS.days, Math.round(INTERNS.xpBonus * 100))}</p>
                    <ActionButton action={{ type: 'requestInternship', organizationId: c.id }} className="btn-ghost px-3 py-1.5 text-sm">{t('🎓 Поискай стаж')}</ActionButton>
                  </div>
                )}
                {features.mergers && mine?.rank.isOwner && (
                  <div className="border-t border-asphalt-800 pt-3">
                    <p className="mb-2 text-mist-300">{t('Сливане: предлагаш „{0}“ да влезе в твоята компания като отдел. Решава собственикът ѝ.', c.name)}</p>
                    <ActionButton action={{ type: 'proposeMerger', organizationId: c.id }} confirm={t('Да предложим ли на „{0}“ да се слее с „{1}“?', c.name, mine.company.name)} className="btn-ghost px-3 py-1.5 text-sm">{t('🤝 Предложи сливане')}</ActionButton>
                  </div>
                )}
              </div>
            </Card>
          )}
          {history && (
            <Card title={t('Династия')}>
              <ul className="space-y-1 text-sm">
                {history.owners.map((o) => <li key={`${o.userId}-${o.fromAt.toISOString()}`} className="flex justify-between gap-2"><span className="font-medium">{tx(o.username)}</span><span className="text-xs text-mist-400">{date(o.fromAt)} – {o.toAt ? date(o.toAt) : t('днес')}</span></li>)}
              </ul>
              <p className="mt-2 text-xs text-mist-400">{t('Основана {0}.', date(history.foundedAt))}</p>
            </Card>
          )}
          <CompanySeason db={db} organizationId={c.id} />
          <CompanyLicences held={licences} />
          <Card title={t('Какво получават членовете')}>
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between"><span>{t('Бонус към възнаграждението')}</span><span className="num font-semibold text-profit">+{Math.round((bonuses.rewardMultiplier - 1) * 100)}%</span></li>
              <li className="flex justify-between"><span>{t('Отстъпка от наема')}</span><span className="num font-semibold text-cyan-glow">{t('−{0} п.п.', Math.round(bonuses.rentalShareReduction * 100))}</span></li>
              <li className="flex justify-between"><span>{t('Допълнителен опит')}</span><span className="num font-semibold text-prestige">+{Math.round((bonuses.xpMultiplier - 1) * 100)}%</span></li>
            </ul>
            <ul className="mt-4 space-y-1 border-t border-asphalt-800 pt-3 text-xs text-mist-400">
              {COMPANY_UPGRADES.map((u) => <li key={u.id}>{t('{0}: ниво {1} / {2}', u.label, (c.upgrades as UpgradeLevels)[u.id] ?? 0, u.levels.length)}</li>)}
            </ul>
            <p className="mt-3 text-xs text-mist-400">{t('Каса на компанията: {0}', money(c.treasuryCents))}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
