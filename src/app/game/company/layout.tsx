import { CompanyBrand } from '@/components/company/CompanyBrand';
import { CompanyTabs } from '@/components/company/CompanyTabs';
import { ALL_PERMISSIONS, memberCapacity, type UpgradeLevels } from '@/lib/game/company';
import { int } from '@/lib/format';
import { gameContext } from '@/server/game/context';
import { companyHub } from '@/server/game/membership';

/** Members see their company's brand and tabs; everyone else sees the founding / joining view. */
export default async function CompanyLayout({ children }: { children: React.ReactNode }) {
  const { db, user } = await gameContext();
  const hub = await companyHub(db, user.id);
  if (!hub) return children;
  return (
    <div className="space-y-5">
      <CompanyBrand
        company={hub.company}
        hasLogo={hub.assets.has('logo')}
        hasBanner={hub.assets.has('banner')}
        subtitle={`Вашата длъжност: ${hub.rank.name} · ${int(hub.members)} / ${memberCapacity(hub.company.upgrades as UpgradeLevels)} членове`}
      />
      <CompanyTabs pending={hub.pending.length} allowed={hub.rank.isOwner ? [...ALL_PERMISSIONS] : hub.rank.permissions} />
      {children}
    </div>
  );
}
