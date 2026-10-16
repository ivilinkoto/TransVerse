import { Building2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui';

export interface BrandInfo {
  id: string;
  name: string | null;
  tag: string | null;
  color: string | null;
  companyLevel: number;
  brandingVersion: number;
}

export const assetUrl = (c: Pick<BrandInfo, 'id' | 'brandingVersion'>, kind: 'logo' | 'banner') => `/api/company/${c.id}/${kind}?v=${c.brandingVersion}`;

export function CompanyLogo({ company, hasLogo, size = 56 }: { company: BrandInfo; hasLogo: boolean; size?: number }) {
  return hasLogo ? (
    // eslint-disable-next-line @next/next/no-img-element -- user images are served by our own API with a versioned URL
    <img src={assetUrl(company, 'logo')} alt={`Лого на ${company.name ?? 'компанията'}`} width={size} height={size} className="shrink-0 rounded-xl border border-asphalt-700 bg-asphalt-850 object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="flex shrink-0 items-center justify-center rounded-xl border border-asphalt-700 bg-asphalt-850" style={{ width: size, height: size, color: company.color ?? undefined }}>
      <Building2 className="h-1/2 w-1/2" />
    </span>
  );
}

/** Banner, logo, name, tag and level of a company. */
export function CompanyBrand({ company, hasLogo, hasBanner, subtitle, actions }: { company: BrandInfo; hasLogo: boolean; hasBanner: boolean; subtitle?: ReactNode; actions?: ReactNode }) {
  const accent = company.color ?? '#3b82f6';
  return (
    <section className="panel overflow-hidden">
      <div className="h-28 w-full sm:h-40" style={{ background: hasBanner ? `center / cover no-repeat url(${assetUrl(company, 'banner')})` : `linear-gradient(120deg, ${accent}55, #0b1220 70%)` }} role="img" aria-label="Банер на компанията" />
      <div className="flex flex-wrap items-end gap-4 px-4 pb-4 sm:px-5">
        <div className="-mt-8 rounded-2xl border-4 border-asphalt-900 bg-asphalt-900">
          <CompanyLogo company={company} hasLogo={hasLogo} size={72} />
        </div>
        <div className="min-w-0 flex-1 pt-3">
          <h1 className="flex flex-wrap items-center gap-2 font-display text-2xl font-bold">
            {company.tag && <span style={{ color: accent }}>[{company.tag}]</span>}
            {company.name}
            <Badge tone="violet">Ниво {company.companyLevel}</Badge>
          </h1>
          {subtitle && <div className="mt-1 text-sm text-mist-400">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2 pt-3">{actions}</div>}
      </div>
    </section>
  );
}
