import { PlayerName } from '@/components/game/PlayerName';
import { isVip } from '@/lib/game/vip';
import { Building2, ScrollText } from 'lucide-react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { CompanyBrand } from '@/components/company/CompanyBrand';
import { JoinCompanyForm } from '@/components/company/forms';
import { Badge, Card, Table } from '@/components/ui';
import { int, money } from '@/lib/format';
import { COMPANY_UPGRADES, memberBonuses, memberCapacity, RECRUITMENT, type UpgradeLevels } from '@/lib/game/company';
import { gameContext } from '@/server/game/context';
import { CompanyLicences } from '@/components/company/CompanyLicences';
import { companyLicenceSet } from '@/server/game/licences';
import { assetKinds, companyMembersView, membershipOf, myApplications, publicCompany } from '@/server/game/membership';

export const metadata = { title: 'Компания' };

export default async function PublicCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { db, user, now } = await gameContext();
  const row = await publicCompany(db, id);
  if (!row) notFound();
  const c = row.company;
  const [assets, members, mine, applications, licences] = await Promise.all([assetKinds(db, c.id), companyMembersView(db, c.id), membershipOf(db, user.id), myApplications(db, user.id), companyLicenceSet(db, c.id)]);
  const capacity = memberCapacity(c.upgrades as UpgradeLevels);
  const bonuses = memberBonuses(c.upgrades as UpgradeLevels);
  const applied = applications.some((a) => a.application.companyId === c.id);
  const blocker =
    mine?.company.id === c.id ? 'Вие сте член на тази компания.'
    : mine ? 'Вече членувате в друга компания. Напуснете я, за да се присъедините тук.'
    : applied ? 'Кандидатурата ви чака одобрение.'
    : c.recruitment === 'closed' ? 'Компанията в момента не приема нови членове.'
    : user.level < c.minJoinLevel ? `Компанията приема играчи от ниво ${c.minJoinLevel} (вие сте ниво ${user.level}).`
    : row.members >= capacity ? 'Компанията няма свободни места.'
    : null;
  return (
    <div className="space-y-6">
      <CompanyBrand company={c} hasLogo={assets.has('logo')} hasBanner={assets.has('banner')} subtitle={`Собственик ${row.owner} · ${int(row.members)} / ${capacity} членове · ${int(row.deliveries)} курса на членовете`} actions={<Link href="/game/companies" className="btn-ghost">← Всички компании</Link>} />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Card title={<span className="inline-flex items-center gap-2"><Building2 className="h-4 w-4 text-mist-400" />За компанията</span>}>
            {c.description ? <p className="whitespace-pre-wrap break-words text-sm text-mist-200">{c.description}</p> : <p className="text-sm text-mist-400">Няма описание.</p>}
          </Card>
          <Card title={<span className="inline-flex items-center gap-2"><ScrollText className="h-4 w-4 text-mist-400" />Правила</span>}>
            {c.rules ? <p className="whitespace-pre-wrap break-words text-sm text-mist-200">{c.rules}</p> : <p className="text-sm text-mist-400">Няма публикувани правила.</p>}
          </Card>
          <Card title="Членове">
            <Table head={['Играч', 'Длъжност', 'Ниво', 'Курсове']}>
              {members.map((m) => (
                <tr key={m.userId}>
                  <td className="px-3 py-2 font-semibold"><PlayerName name={m.username} role={m.role} vip={isVip(m.vipUntil, now)} /></td>
                  <td className="px-3 py-2"><Badge tone={m.rank.isOwner ? 'gold' : 'neutral'}>{m.rank.name}</Badge></td>
                  <td className="num px-3 py-2">{m.level}</td>
                  <td className="num px-3 py-2">{int(m.member.deliveries)}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Присъединяване">
            <p className="mb-4 text-sm text-mist-300">{RECRUITMENT[c.recruitment as keyof typeof RECRUITMENT] ?? c.recruitment}. Вноска към компанията: <span className="num font-semibold">{Math.round(c.contributionRate * 100)}%</span> от възнаграждението за курс.</p>
            <JoinCompanyForm companyId={c.id} mode={c.recruitment === 'open' ? 'open' : 'application'} disabled={blocker} />
          </Card>
          <CompanyLicences held={licences} />
          <Card title="Какво получават членовете">
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between"><span>Бонус към възнаграждението</span><span className="num font-semibold text-profit">+{Math.round((bonuses.rewardMultiplier - 1) * 100)}%</span></li>
              <li className="flex justify-between"><span>Отстъпка от наема</span><span className="num font-semibold text-cyan-glow">−{Math.round(bonuses.rentalShareReduction * 100)} п.п.</span></li>
              <li className="flex justify-between"><span>Допълнителен опит</span><span className="num font-semibold text-prestige">+{Math.round((bonuses.xpMultiplier - 1) * 100)}%</span></li>
            </ul>
            <ul className="mt-4 space-y-1 border-t border-asphalt-800 pt-3 text-xs text-mist-400">
              {COMPANY_UPGRADES.map((u) => <li key={u.id}>{u.label}: ниво {(c.upgrades as UpgradeLevels)[u.id] ?? 0} / {u.levels.length}</li>)}
            </ul>
            <p className="mt-3 text-xs text-mist-400">Каса на компанията: {money(c.treasuryCents)}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
