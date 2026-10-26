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
import { t, tx, intlLocale } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Развитие на компанията') };
}

export default async function DevelopmentPage() {
  await initLocale();
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
      <Card title={t('Как се развива компанията')}>
        <p className="text-sm text-mist-300">
          {t('Всеки курс на член носи опит на компанията и тя качва нива. Подобренията се купуват от касата на компанията — отделна от личните пари на всеки член, включително собственика. Касата се пълни от вноските от курсовете и от доброволни вноски на членовете. Каса:')}{' '}<span className="num font-semibold text-gold-400">{money(c.treasuryCents)}</span>
        </p>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        {COMPANY_UPGRADES.map((u) => {
          const current = levels[u.id] ?? 0;
          const next = u.levels[current];
          const lockedByLevel = next && c.companyLevel < next.minCompanyLevel;
          return (
            <Card key={u.id} title={<span className="inline-flex items-center gap-2">{tx(u.label)}<Badge tone="cyan">{current} / {tx(u.levels.length)}</Badge></span>}>
              <p className="text-sm text-mist-300">{current > 0 ? t('Сега: {0}', u.description(current)) : t('Още не е изградено.')}</p>
              <Meter value={(current / u.levels.length) * 100} tone="cyan" className="mt-3" />
              {next ? (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm">
                    <div>{t('Следващо ниво: {0}', u.description(current + 1))}</div>
                    {!onPlot(u.id) && <div className="mt-0.5 text-mist-400">{t('Цена')}{' '}<span className="num text-gold-400">{money(next.costCents)}</span>{next.minCompanyLevel > 1 && t(' · изисква ниво {0} на компанията', next.minCompanyLevel)}</div>}
                  </div>
                  {onPlot(u.id) ? (
                    <Link href="/game/company/plot" className="btn-primary px-4 py-2 text-sm">{t('Строи се на участъка →')}</Link>
                  ) : manage ? (
                    <ActionButton action={{ type: 'buyCompanyUpgrade', upgradeId: u.id }} className="btn-gold px-4 py-2 text-sm" disabled={!!lockedByLevel || c.treasuryCents < next.costCents} confirm={t('Да платите {0} от касата?', money(next.costCents))}>
                      {lockedByLevel ? t('Ниво {0}', next.minCompanyLevel) : t('Подобри')}
                    </ActionButton>
                  ) : (
                    <span className="text-xs text-mist-400">{t('Нужно е право „Развитие“')}</span>
                  )}
                </div>
              ) : (
                <p className="mt-4 text-sm text-profit">{t('Максимално ниво.')}</p>
              )}
            </Card>
          );
        })}
      </div>
      <Card title={t('Отключвания по ниво')}>
        <ul className="space-y-2">
          {COMPANY_UNLOCKS.map((u) => {
            const open = c.companyLevel >= u.level;
            return (
              <li key={u.key} className="flex items-center gap-3 text-sm">
                {open ? <CheckCircle2 className="h-4 w-4 shrink-0 text-profit" /> : <Lock className="h-4 w-4 shrink-0 text-mist-400" />}
                <span className="num w-16 shrink-0 text-mist-400">{t('Ниво {0}', u.level)}</span>
                <span className={open ? '' : 'text-mist-400'}>{tx(u.label)}</span>
                {!open && <span className="num ml-auto text-xs text-mist-400">{t('{0} опит', (companyXpForLevel(u.level) - c.companyXp).toLocaleString(intlLocale()))}</span>}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
