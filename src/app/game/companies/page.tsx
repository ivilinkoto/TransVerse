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

export const metadata = { title: 'Компании' };

const RECRUIT_BADGE = { open: { tone: 'green', label: 'Отворена' }, application: { tone: 'blue', label: 'С кандидатура' }, closed: { tone: 'neutral', label: 'Затворена' } } as const;

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { db } = await gameContext();
  const q = ((await searchParams).q ?? '').slice(0, 40);
  const [list, logos] = await Promise.all([companyDirectory(db, q), db.select({ companyId: companyAssets.companyId }).from(companyAssets).where(eq(companyAssets.kind, 'logo'))]);
  const withLogo = new Set(logos.map((l) => l.companyId));
  return (
    <div className="space-y-6">
      <PageHeader title="Компании" subtitle="Транспортни компании на играчите. Присъедини се към екип и получавай бонусите му, или основи своя." />
      <form className="flex max-w-md gap-2" role="search">
        <input name="q" defaultValue={q} className="input" placeholder="Търси по име" aria-label="Търси компания" />
        <button className="btn-ghost"><Search className="h-4 w-4" />Търси</button>
      </form>
      {list.length === 0 ? (
        <Empty icon={Users} title="Няма намерени компании">{q ? 'Опитайте с друго име.' : 'Все още никой не е основал компания. Бъдете първи!'}</Empty>
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
                      <div className="truncate font-display font-bold">{c.tag && <span style={{ color: c.color ?? undefined }}>[{c.tag}] </span>}{c.name}</div>
                      <div className="text-xs text-mist-400">Собственик {c.owner} · ниво {c.companyLevel}</div>
                    </div>
                  </div>
                  {c.description && <p className="mt-3 line-clamp-2 text-sm text-mist-300">{c.description}</p>}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Badge tone={recruit.tone}>{recruit.label}</Badge>
                    <Badge>{int(c.members)} / {memberCapacity(c.upgrades as UpgradeLevels)} членове</Badge>
                    {c.minJoinLevel > 1 && <Badge tone="orange">от ниво {c.minJoinLevel}</Badge>}
                    {b.rewardMultiplier > 1 && <Badge tone="green">+{Math.round((b.rewardMultiplier - 1) * 100)}% възнаграждение</Badge>}
                    {b.rentalShareReduction > 0 && <Badge tone="cyan">по-евтин наем</Badge>}
                    {b.xpMultiplier > 1 && <Badge tone="violet">+{Math.round((b.xpMultiplier - 1) * 100)}% опит</Badge>}
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
