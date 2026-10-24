import { Building2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui';
import { t, tx } from '@/i18n/t';

export interface BrandInfo {
  id: string;
  name: string | null;
  tag: string | null;
  color: string | null;
  companyLevel: number;
  brandingVersion: number;
  /** v1.9: a logo drawn in the game. */
  logoDesign?: LogoDesign | null;
}

export interface LogoDesign {
  shape: string;
  color: string;
  accent: string;
  initials: string;
  stripe?: boolean;
}

const SHAPES: Record<string, string> = {
  circle: 'M50 4a46 46 0 1 1 0 92a46 46 0 1 1 0-92Z',
  shield: 'M50 4 L92 18 V48 C92 72 74 88 50 96 C26 88 8 72 8 48 V18 Z',
  hex: 'M50 4 L90 27 V73 L50 96 L10 73 V27 Z',
  diamond: 'M50 4 L96 50 L50 96 L4 50 Z',
  square: 'M14 4 H86 Q96 4 96 14 V86 Q96 96 86 96 H14 Q4 96 4 86 V14 Q4 4 14 4 Z',
};

/** v1.9: a company logo drawn from a shape, two colours and the initials (no upload). */
export function DesignedLogo({ design, size = 56 }: { design: LogoDesign; size?: number }) {
  const path = SHAPES[design.shape] ?? SHAPES.circle!;
  const fs = design.initials.length >= 3 ? 30 : design.initials.length === 2 ? 38 : 48;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="shrink-0" role="img" aria-label={t('Лого {0}', design.initials)}>
      <path d={path} fill={design.color} stroke={design.accent} strokeWidth="4" />
      {design.stripe && <path d="M4 62 H96 V72 H4 Z" fill={design.accent} opacity="0.85" clipPath="none" />}
      <text x="50" y="52" dominantBaseline="middle" textAnchor="middle" fontFamily="Exo 2, sans-serif" fontWeight="800" fontSize={fs} fill={design.accent}>{design.initials.toUpperCase()}</text>
    </svg>
  );
}

export const assetUrl = (c: Pick<BrandInfo, 'id' | 'brandingVersion'>, kind: 'logo' | 'banner') => `/api/company/${c.id}/${kind}?v=${c.brandingVersion}`;

export function CompanyLogo({ company, hasLogo, size = 56 }: { company: BrandInfo; hasLogo: boolean; size?: number }) {
  return hasLogo ? (
    // eslint-disable-next-line @next/next/no-img-element -- user images are served by our own API with a versioned URL
    <img src={assetUrl(company, 'logo')} alt={t('Лого на {0}', company.name ?? t('компанията'))} width={size} height={size} className="shrink-0 rounded-xl border border-asphalt-700 bg-asphalt-850 object-cover" style={{ width: size, height: size }} />
  ) : company.logoDesign ? (
    <DesignedLogo design={company.logoDesign} size={size} />
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
      <div className="h-28 w-full sm:h-40" style={{ background: hasBanner ? `center / cover no-repeat url(${assetUrl(company, 'banner')})` : `linear-gradient(120deg, ${accent}55, #0b1220 70%)` }} role="img" aria-label={t('Банер на компанията')} />
      <div className="flex flex-wrap items-end gap-4 px-4 pb-4 sm:px-5">
        <div className="-mt-8 rounded-2xl border-4 border-asphalt-900 bg-asphalt-900">
          <CompanyLogo company={company} hasLogo={hasLogo} size={72} />
        </div>
        <div className="min-w-0 flex-1 pt-3">
          <h1 className="flex flex-wrap items-center gap-2 font-display text-2xl font-bold">
            {company.tag && <span style={{ color: accent }}>[{tx(company.tag)}]</span>}
            {tx(company.name)}
            <Badge tone="violet">{t('Ниво {0}', company.companyLevel)}</Badge>
          </h1>
          {subtitle && <div className="mt-1 text-sm text-mist-400">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2 pt-3">{actions}</div>}
      </div>
    </section>
  );
}
