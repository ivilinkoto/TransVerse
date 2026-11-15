import type { Metadata } from 'next';
import { Card, PageHeader } from '@/components/ui';
import { ACCOUNT_MENU, SECTIONS } from '@/components/game/nav';
import { int } from '@/lib/format';
import { adminContext } from '@/server/admin-context';
import { featureUsage } from '@/server/admin-usage';
import { COIN_REASON_LABELS, type CoinReason } from '@/server/game/coins';
import { LEDGER_LABELS, type LedgerCategory } from '@/server/game/finance';
import { XP_REASON_LABELS, type XpReason } from '@/server/game/progression';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Използване') };
}
export const dynamic = 'force-dynamic';

/** The menu name of a page. */
const PAGE_NAMES = new Map<string, string>([...SECTIONS.flatMap((s) => [[s.href, s.label] as [string, string], ...(s.tabs ?? []).map((x) => [x.href, x.label] as [string, string])]), ...ACCOUNT_MENU.map((m) => [m.href, m.label] as [string, string]), ['/game/play', 'Игри и награди'], ['/game', 'Начало']]);

function Rows({ rows, active, label }: { rows: { key: string; players: number }[]; active: number; label: (key: string) => string }) {
  if (!rows.length) return <p className="text-sm text-mist-400">{t('Няма данни за този период.')}</p>;
  const peak = Math.max(1, ...rows.map((r) => r.players));
  return (
    <ul className="space-y-1.5 text-sm">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
          <span className="truncate">{tx(label(r.key))}</span>
          <span className="num text-right font-semibold">{int(r.players)} <span className="text-xs font-normal text-mist-400">{active ? `${Math.round((r.players / active) * 100)}%` : ''}</span></span>
          <span className="col-span-2 h-1.5 rounded-full bg-asphalt-800"><span className="block h-full rounded-full bg-cyan-glow/70" style={{ width: `${(r.players / peak) * 100}%` }} /></span>
        </li>
      ))}
    </ul>
  );
}

/** What players really use (players only): pages opened, and what paid them experience, ТрансКоин or money. */
export default async function AdminUsage() {
  await initLocale();
  const { db, now } = await adminContext({ admin: true });
  const u = await featureUsage(db, now);
  return (
    <div className="space-y-6">
      <PageHeader title={t('Използване')} subtitle={t('Колко различни играчи ползват всяко нещо за последните {0} дни — за да решим какво остава в играта. Само играчи, без екипа.', u.days)} />
      <p className="text-sm text-mist-300">{t('Активни играчи за {0} дни: {1}. Процентът е спрямо тях.', u.days, int(u.active))}</p>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title={t('Отворени страници')}>
          <p className="mb-3 text-xs text-mist-400">{u.pages.since ? t('Броят се от {0}. Страница, която не е в списъка, никой не е отворил.', u.pages.since) : t('Броенето започва от днес — след няколко дни тук ще се види кои страници се отварят.')}</p>
          <Rows rows={u.pages.pages.map((p) => ({ key: p.page, players: p.players }))} active={u.active} label={(k) => PAGE_NAMES.get(k) ?? k} />
        </Card>
        <Card title={t('Опит по източник')}>
          <p className="mb-3 text-xs text-mist-400">{t('Играчи, получили опит от това (мини-игри, мисии, доставки…).')}</p>
          <Rows rows={u.xp} active={u.active} label={(k) => XP_REASON_LABELS[k as XpReason] ?? k} />
        </Card>
        <Card title={t('ТрансКоин по източник')}>
          <Rows rows={u.coins} active={u.active} label={(k) => COIN_REASON_LABELS[k as CoinReason] ?? k} />
        </Card>
        <Card title={t('Пари по вид')}>
          <p className="mb-3 text-xs text-mist-400">{t('Собственици на превозвачи с движение от този вид (застраховки, акции, контрабанда, наеми…).')}</p>
          <Rows rows={u.money} active={u.active} label={(k) => LEDGER_LABELS[k as LedgerCategory] ?? k} />
        </Card>
      </div>
    </div>
  );
}
