import { Search, Users } from 'lucide-react';
import Link from 'next/link';
import { CompanyLogo } from '@/components/company/CompanyBrand';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { int } from '@/lib/format';
import { memberBonuses, memberCapacity, type UpgradeLevels } from '@/lib/game/company';
import { gameContext } from '@/server/game/context';
import { companyDirectory } from '@/server/game/membership';
import { companyAssets } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Компании') };
}

const RECRUIT_BADGE = { open: { tone: 'green', label: 'Отворена' }, application: { tone: 'blue', label: 'С кандидатура' }, closed: { tone: 'neutral', label: 'Затворена' } } as const;

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await initLocale();
  const { db } = await gameContext();
  const q = ((await searchParams).q ?? '').slice(0, 40);
  const [list, logos] = await Promise.all([companyDirectory(db, q), db.select({ companyId: companyAssets.companyId }).from(companyAssets).where(eq(companyAssets.kind, 'logo'))]);
  const withLogo = new Set(logos.map((l) => l.companyId));
  return (
    <div className="space-y-6">
      <PageHeader title={t('Компании')} subtitle={t('Транспортни компании на играчите. Присъедини се към екип и получавай бонусите му, или основи своя.')} />
      <form className="flex max-w-md gap-2" role="search">
        <input name="q" defaultValue={q} className="input" placeholder={t('Търси по име')} aria-label={t('Търси компания')} />
        <button className="btn-ghost"><Search className="h-4 w-4" />{t('Търси')}</button>
      </form>
      {list.length === 0 ? (
        <Empty icon={Users} title={t('Няма намерени компании')}>{q ? t('Опитайте с друго име.') : t('Все още никой не е основал компания. Бъдете първи!')}</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((c) => {
            const b = memberBonuses(c.upgrades as UpgradeLevels);
            const recruit = RECRUIT_BADGE[c.recruitment as keyof typeof RECRUIT_BADGE] ?? RECRUIT_BADGE.closed;
            return (
              <Link key={c.id} href={`/game/companies/${c.id}`} className="block transition hover:-translate-y-0.5">
                <Card className="h-full">
                  <div className="flex items-start gap-3">
                    <CompanyLogo company={c} hasLogo={withLogo.has(c.id)} size={48} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-display font-bold">{c.tag && <span style={{ color: c.color ?? undefined }}>[{tx(c.tag)}] </span>}{tx(c.name)}</div>
                      <div className="text-xs text-mist-400">{t('Собственик {0} · ниво {1}', c.owner, c.companyLevel)}</div>
                    </div>
                  </div>
                  {c.description && <p className="mt-3 line-clamp-2 text-sm text-mist-300">{tx(c.description)}</p>}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Badge tone={recruit.tone}>{tx(recruit.label)}</Badge>
                    <Badge>{t('{0} / {1} членове', int(c.members), memberCapacity(c.upgrades as UpgradeLevels))}</Badge>
                    {c.minJoinLevel > 1 && <Badge tone="orange">{t('от ниво {0}', c.minJoinLevel)}</Badge>}
                    {b.rewardMultiplier > 1 && <Badge tone="green">{t('+{0}% възнаграждение', Math.round((b.rewardMultiplier - 1) * 100))}</Badge>}
                    {b.rentalShareReduction > 0 && <Badge tone="cyan">{t('по-евтин наем')}</Badge>}
                    {b.xpMultiplier > 1 && <Badge tone="violet">{t('+{0}% опит', Math.round((b.xpMultiplier - 1) * 100))}</Badge>}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
