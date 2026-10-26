import { MapPinned } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { SelectAction } from '@/components/ui/SelectAction';
import { ActionButton } from '@/components/ui/ActionButton';
import { Card, Empty, PageHeader } from '@/components/ui';
import { date, money } from '@/lib/format';
import { BRANCH, branchSlots } from '@/lib/game/business';
import { branchCities, branchesOf } from '@/server/game/business';
import { gameContext } from '@/server/game/context';
import { can, membershipOf } from '@/server/game/membership';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Филиали') };
}

export default async function BranchesPage() {
  await initLocale();
  const { db, user, features } = await gameContext();
  if (!features.branches) notFound();
  const m = await membershipOf(db, user.id);
  if (!m) redirect('/game/company');
  const [list, options] = await Promise.all([branchesOf(db, m.company.id), branchCities(db, m.company.hqCityId, features.europe, features.open_world)]);
  const slots = branchSlots(m.company.companyLevel);
  const canRun = can(m.rank, 'manage_upgrades');
  const free = options.filter((c) => !list.some((b) => b.cityId === c.id));
  return (
    <div className="space-y-6">
      <PageHeader
        title={t('Филиали')}
        subtitle={t('Малка база в друг голям град: курсовете на членовете до там носят +{0} %, а оттам тръгват товари само за компанията.', Math.round(BRANCH.bonusShare * 100))}
        help={t('Филиал струва {0} от касата. Компанията може да има 1 филиал от ниво 4, 2 от ниво 6 и 3 от ниво 8. Всеки филиал държи по {1} товара на борсата само за членовете (с {2} % по-добро заплащане). Отварят и затварят длъжностите с право „Развитие“. Затвореният филиал не връща парите.', money(BRANCH.priceCents), BRANCH.loads, Math.round((BRANCH.loadMultiplier - 1) * 100))}
      />
      <Card title={t('Филиали · {0} от {1}', list.length, slots)}>
        {list.length === 0 ? (
          <Empty icon={MapPinned} title={t('Компанията още няма филиал')}>{slots ? t('Изберете град по-долу.') : t('Филиали се отварят от ниво 4 на компанията.')}</Empty>
        ) : (
          <ul className="divide-y divide-asphalt-800 text-sm">
            {list.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><b>{tx(b.name)}</b> <span className="text-xs text-mist-400">{t('{0} · от {1}', b.country, date(b.createdAt))}</span></span>
                {canRun && <ActionButton action={{ type: 'closeBranch', branchId: b.id }} className="btn-ghost px-3 py-1.5 text-xs" confirm={t('Да затворим ли филиала в {0}? Парите не се връщат.', b.name)}>{t('Затвори')}</ActionButton>}
              </li>
            ))}
          </ul>
        )}
        {canRun && list.length < slots && free.length > 0 && (
          <div className="mt-4">
            <div className="label mb-1">{t('Отвори филиал · {0} от касата', money(BRANCH.priceCents))}</div>
            <SelectAction
              label={t('Отвори')}
              ariaLabel={t('Град на филиала')}
              value={String(free[0]!.id)}
              options={free.map((c) => ({ value: String(c.id), label: `${tx(c.name)} (${c.country})` }))}
              action={{ type: 'openBranch' }}
              field="cityId"
              numeric
            />
          </div>
        )}
      </Card>
    </div>
  );
}
