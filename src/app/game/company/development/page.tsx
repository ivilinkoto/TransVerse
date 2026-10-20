import { CheckCircle2, Lock } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BUILDINGS } from '@/lib/game/plot';
import { Badge, Card, Meter } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { money } from '@/lib/format';
import { COMPANY_UNLOCKS, COMPANY_UPGRADES, companyXpForLevel, type UpgradeLevels } from '@/lib/game/company';
import { gameContext } from '@/server/game/context';
import { can, companyHub } from '@/server/game/membership';

export const metadata = { title: 'Развитие на компанията' };

export default async function DevelopmentPage() {
  const { db, user, features } = await gameContext();
  // With the plot (v1.3) these upgrades are buildings, built there.
  const onPlot = (id: string) => features.company_plot && Object.values(BUILDINGS).some((b) => b.upgrade === id);
  const hub = await companyHub(db, user.id);
  if (!hub) redirect('/game/company');
  const c = hub.company;
  const levels = c.upgrades as UpgradeLevels;
  const manage = can(hub.rank, 'manage_upgrades');
  return (
    <div className="space-y-6">
      <Card title="Как се развива компанията">
        <p className="text-sm text-mist-300">
          Всеки курс на член носи опит на компанията и тя качва нива. Подобренията се купуват от касата на компанията — отделна от личните пари на всеки член, включително собственика. Касата се пълни от вноските от курсовете и от доброволни вноски на членовете. Каса: <span className="num font-semibold text-gold-400">{money(c.treasuryCents)}</span>
        </p>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        {COMPANY_UPGRADES.map((u) => {
          const current = levels[u.id] ?? 0;
          const next = u.levels[current];
          const lockedByLevel = next && c.companyLevel < next.minCompanyLevel;
          return (
            <Card key={u.id} title={<span className="inline-flex items-center gap-2">{u.label}<Badge tone="cyan">{current} / {u.levels.length}</Badge></span>}>
              <p className="text-sm text-mist-300">{current > 0 ? `Сега: ${u.description(current)}` : 'Още не е изградено.'}</p>
              <Meter value={(current / u.levels.length) * 100} tone="cyan" className="mt-3" />
              {next ? (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm">
                    <div>Следващо ниво: {u.description(current + 1)}</div>
                    {!onPlot(u.id) && <div className="mt-0.5 text-mist-400">Цена <span className="num text-gold-400">{money(next.costCents)}</span>{next.minCompanyLevel > 1 && ` · изисква ниво ${next.minCompanyLevel} на компанията`}</div>}
                  </div>
                  {onPlot(u.id) ? (
                    <Link href="/game/company/plot" className="btn-primary px-4 py-2 text-sm">Строи се на участъка →</Link>
                  ) : manage ? (
                    <ActionButton action={{ type: 'buyCompanyUpgrade', upgradeId: u.id }} className="btn-gold px-4 py-2 text-sm" disabled={!!lockedByLevel || c.treasuryCents < next.costCents} confirm={`Да платите ${money(next.costCents)} от касата?`}>
                      {lockedByLevel ? `Ниво ${next.minCompanyLevel}` : 'Подобри'}
                    </ActionButton>
                  ) : (
                    <span className="text-xs text-mist-400">Нужно е право „Развитие“</span>
                  )}
                </div>
              ) : (
                <p className="mt-4 text-sm text-profit">Максимално ниво.</p>
              )}
            </Card>
          );
        })}
      </div>
      <Card title="Отключвания по ниво">
        <ul className="space-y-2">
          {COMPANY_UNLOCKS.map((u) => {
            const open = c.companyLevel >= u.level;
            return (
              <li key={u.key} className="flex items-center gap-3 text-sm">
                {open ? <CheckCircle2 className="h-4 w-4 shrink-0 text-profit" /> : <Lock className="h-4 w-4 shrink-0 text-mist-400" />}
                <span className="num w-16 shrink-0 text-mist-400">Ниво {u.level}</span>
                <span className={open ? '' : 'text-mist-400'}>{u.label}</span>
                {!open && <span className="num ml-auto text-xs text-mist-400">{(companyXpForLevel(u.level) - c.companyXp).toLocaleString('bg-BG')} опит</span>}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
