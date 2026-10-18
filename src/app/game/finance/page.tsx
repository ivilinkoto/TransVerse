import { Fuel, Gavel, Landmark, TrendingDown, TrendingUp } from 'lucide-react';
import { ActionButton } from '@/components/ui/ActionButton';
import { FINE_RULES, VIOLATION_LABELS, type Violation } from '@/lib/game/fines';
import { finesOf } from '@/server/game/fines';
import { CashflowChart } from '@/components/game/CashflowChart';
import { Badge, Card, PageHeader, Stat } from '@/components/ui';
import { dateTime, money, moneyPrecise } from '@/lib/format';
import { TutorialVisit } from '@/components/game/TutorialVisit';
import { fuelPriceCents } from '@/lib/game/fuel';
import { countries } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';
import { tutorialPending } from '@/server/game/tutorial-flags';
import { LEDGER_LABELS, type LedgerCategory } from '@/server/game/finance';
import { financeSummary, ledgerPage } from '@/server/game/queries';

export const metadata = { title: 'Финанси' };

export default async function FinancePage() {
  const { db, user, company, now } = await gameContext();
  const [summary, entries, fineRows] = await Promise.all([financeSummary(db, company.id, 30), ledgerPage(db, company.id, 120), finesOf(db, company.id)]);
  const income = summary.byCategory.filter((c) => c.total > 0 && c.category !== 'starting_capital').reduce((s, c) => s + c.total, 0);
  const expense = -summary.byCategory.filter((c) => c.total < 0).reduce((s, c) => s + c.total, 0);
  const sorted = [...summary.byCategory].filter((c) => c.category !== 'starting_capital').sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  const maxAbs = Math.max(1, ...sorted.map((c) => Math.abs(c.total)));

  const visitPending = await tutorialPending(db, user.id, 'finances');
  const countryRows = await db.select({ code: countries.code }).from(countries).orderBy(countries.code);
  const fuel = countryRows.map((c) => ({ code: c.code, cents: fuelPriceCents(c.code, now) }));
  const cheapest = Math.min(...fuel.map((f) => f.cents));
  const dearest = Math.max(...fuel.map((f) => f.cents));
  return (
    <div className="space-y-6">
      <TutorialVisit step="finances" pending={visitPending} />
      <PageHeader title="Финанси" subtitle="Приходи, разходи и всяко движение на парите."
        help="Счетоводна книга: всяко движение на пари е запис с баланс след него. Всички суми се изчисляват от сървъра." />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
        <Stat label="Наличност" value={money(company.balanceCents)} tone={company.balanceCents < 0 ? 'loss' : 'gold'} icon={Landmark} />
        <Stat label="Приходи · 30 дни" value={money(income)} tone="profit" icon={TrendingUp} />
        <Stat label="Разходи · 30 дни" value={money(expense)} tone="loss" icon={TrendingDown} hint={`Нетно ${money(income - expense)}`} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card title="Паричен поток по дни"><CashflowChart days={summary.daily} /></Card>
        <Card title="По категории · 30 дни">
          <ul className="space-y-2.5 text-sm">
            {sorted.map((c) => (
              <li key={c.category}>
                <div className="flex justify-between"><span>{LEDGER_LABELS[c.category as LedgerCategory] ?? c.category}</span><span className={`num ${c.total >= 0 ? 'text-profit' : 'text-loss'}`}>{money(c.total)}</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-asphalt-700"><div className={`h-full rounded-full ${c.total >= 0 ? 'bg-profit' : 'bg-loss'}`} style={{ width: `${(Math.abs(c.total) / maxAbs) * 100}%` }} /></div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      {fineRows.length > 0 && (
        <Card id="fines" title={<span className="inline-flex items-center gap-2"><Gavel className="h-4 w-4 text-mist-400" />Глоби</span>} actions={<span className="text-xs text-mist-400">плащане до {FINE_RULES.dueHours} ч, после +{Math.round(FINE_RULES.latePayShare * 100)}%</span>}>
          <ul className="divide-y divide-asphalt-800 text-sm">
            {fineRows.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="font-medium">{VIOLATION_LABELS[f.violation as Violation]} <span className="num text-loss">{money(f.amountCents)}</span></div>
                  <div className="text-xs text-mist-400">{dateTime(f.createdAt)}{f.status === 'unpaid' ? ` · срок ${dateTime(f.dueAt)}` : ''}{f.note ? ` · ${f.note}` : ''}</div>
                </div>
                {f.status === 'unpaid' ? (
                  <div className="flex gap-2">
                    <ActionButton action={{ type: 'payFine', fineId: f.id }} className="btn-primary px-3 py-1.5 text-xs">Плати</ActionButton>
                    {!f.appealed && <ActionButton action={{ type: 'appealFine', fineId: f.id }} className="btn-ghost px-3 py-1.5 text-xs" confirm={`Обжалване: ${Math.round(FINE_RULES.appealWinChance * 100)}% шанс глобата да отпадне, иначе става с ${Math.round(FINE_RULES.appealLossShare * 100)}% по-голяма. Обжалваш ли?`}>Обжалвай</ActionButton>}
                  </div>
                ) : (
                  <Badge tone={f.status === 'dropped' ? 'green' : 'neutral'}>{f.status === 'dropped' ? 'отменена' : f.status === 'auto_paid' ? 'удържана' : 'платена'}</Badge>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title={<span className="inline-flex items-center gap-2"><Fuel className="h-4 w-4 text-mist-400" />Дизел днес</span>} actions={<span className="text-xs text-mist-400">игрови цени · сменят се всеки ден</span>}>
        <p className="mb-3 text-sm text-mist-400">Горивото за курса се плаща по цените на държавите, през които минава камионът — пропорционално на километрите във всяка.</p>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {fuel.map((f) => (
            <li key={f.code} className="flex items-center justify-between rounded-lg bg-asphalt-850 px-3 py-2 text-sm"><span className="text-mist-300">{f.code}</span><span className={`num font-semibold ${f.cents <= cheapest * 1.05 ? 'text-profit' : f.cents >= dearest * 0.95 ? 'text-loss' : ''}`}>{(f.cents / 100).toFixed(2)} лв./л</span></li>
          ))}
        </ul>
      </Card>
      <Card title="Счетоводна книга">
        <ul className="divide-y divide-asphalt-800">
          {entries.map((e) => (
            <li key={e.id} className="flex items-start gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <div className="text-mist-100">{e.description}</div>
                <div className="text-xs text-mist-400">{dateTime(e.createdAt)} · {LEDGER_LABELS[e.category as LedgerCategory] ?? e.category}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className={`num whitespace-nowrap font-semibold ${e.amountCents >= 0 ? 'text-profit' : 'text-loss'}`}>{e.amountCents >= 0 ? '+' : ''}{moneyPrecise(e.amountCents)}</div>
                <div className="num whitespace-nowrap text-xs text-mist-400">баланс {moneyPrecise(e.balanceAfterCents)}</div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
