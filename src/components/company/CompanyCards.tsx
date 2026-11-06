import Link from 'next/link';
import type { DbOrTx } from '@/server/db/client';
import type { FeatureId } from '@/lib/game/features';
import { currentBattle } from '@/server/game/battles';
import { companyChestOf } from '@/server/game/item-trade';
import { t, tx } from '@/i18n/t';

/** Every company page as a card: an icon and what it is for. */
const CARDS: { href: string; emoji: string; label: string; text: string; feature?: FeatureId }[] = [
  { href: '/game/company/missions', emoji: '🎯', label: 'Мисии', text: 'Седмичните цели, проектът и битката' },
  { href: '/game/company/members', emoji: '👥', label: 'Членове', text: 'Хората в компанията и молбите' },
  { href: '/game/company/development', emoji: '📈', label: 'Развитие', text: 'Подобрения и бонуси за членовете' },
  { href: '/game/company/tenders', emoji: '📑', label: 'Търгове', text: 'Големите поръчки за компании' },
  { href: '/game/company/plot', emoji: '🏗️', label: 'Участък', text: 'Базата на компанията', feature: 'company_plot' },
  { href: '/game/company/factory', emoji: '🏭', label: 'Фабрика', text: 'Производство на стоки', feature: 'factories' },
  { href: '/game/company/branches', emoji: '🏢', label: 'Филиали', text: 'Офиси в други градове', feature: 'branches' },
  { href: '/game/company/alliance', emoji: '🤝', label: 'Съюз', text: 'Съюз с други компании', feature: 'alliances' },
  { href: '/game/company/holding', emoji: '🏦', label: 'Холдинг', text: 'Няколко компании заедно', feature: 'holdings' },
  { href: '/game/company/territories', emoji: '🗺️', label: 'Територии', text: 'Области под твоя контрол', feature: 'territories' },
  { href: '/game/company/community', emoji: '🧩', label: 'Общност', text: 'Отдели, събрания, традиции', feature: 'departments' },
];

/**
 * 1.2.2: the start of „Компания“ — what waits for the company (applications,
 * the battle, the chest) and every company page as a card.
 */
export async function CompanyCards({ db, organizationId, pending, now, has }: { db: DbOrTx; organizationId: string; pending: number; now: Date; has: (f: FeatureId) => boolean }) {
  const [battle, chest] = await Promise.all([currentBattle(db, organizationId, now), has('item_chests') ? companyChestOf(db, organizationId) : null]);
  const waiting: { href: string; emoji: string; text: string }[] = [];
  if (pending > 0) waiting.push({ href: '/game/company/members', emoji: '📨', text: t('Молби за членство: {0}', pending) });
  if (battle && battle.status === 'active' && battle.rival) waiting.push({ href: '/game/company/missions', emoji: '⚔️', text: t('Битка срещу „{0}“: {1} : {2} т', tx(battle.rival.name), Math.round(battle.ourTons), Math.round(battle.theirTons)) });
  const inChest = chest?.items.reduce((s, i) => s + i.qty, 0) ?? 0;
  if (inChest > 0) waiting.push({ href: '/game/company', emoji: '🧰', text: t('Във фирмения сандък: {0}', inChest) });
  return (
    <div className="space-y-4" data-testid="company-cards">
      {waiting.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {waiting.map((w) => (
            <li key={w.text}>
              <Link href={w.href} className="flex items-center gap-3 rounded-2xl border border-cyan-glow/40 bg-cyan-glow/5 p-3 transition hover:-translate-y-0.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-asphalt-850 text-xl" aria-hidden="true">{w.emoji}</span>
                <span className="min-w-0 flex-1 text-sm font-semibold">{w.text}</span>
                <span className="text-cyan-glow">→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {CARDS.filter((c) => !c.feature || has(c.feature)).map((c) => (
          <li key={c.href}>
            <Link href={c.href} className="flex h-full flex-col gap-1 rounded-2xl border border-asphalt-700 bg-asphalt-900/60 p-3 transition hover:-translate-y-0.5 hover:border-cyan-glow/50">
              <span className="text-2xl" aria-hidden="true">{c.emoji}</span>
              <span className="font-semibold">{tx(c.label)}</span>
              <span className="text-xs text-mist-400">{tx(c.text)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
