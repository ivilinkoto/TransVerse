import { Landmark, TrendingDown, TrendingUp } from 'lucide-react';
import { CashflowChart } from '@/components/game/CashflowChart';
import { Card, PageHeader, Stat, Table } from '@/components/ui';
import { dateTime, money, moneyPrecise } from '@/lib/format';
import { TutorialVisit } from '@/components/game/TutorialVisit';
import { gameContext } from '@/server/game/context';
import { tutorialPending } from '@/server/game/tutorial-flags';
import { LEDGER_LABELS, type LedgerCategory } from '@/server/game/finance';
import { financeSummary, ledgerPage } from '@/server/game/queries';

export const metadata = { title: 'Финанси' };

export default async function FinancePage() {
  const { db, user, company } = await gameContext();
  const [summary, entries] = await Promise.all([financeSummary(db, company.id, 30), ledgerPage(db, company.id, 120)]);
  const income = summary.byCategory.filter((c) => c.total > 0 && c.category !== 'starting_capital').reduce((s, c) => s + c.total, 0);
  const expense = -summary.byCategory.filter((c) => c.total < 0).reduce((s, c) => s + c.total, 0);
  const sorted = [...summary.byCategory].filter((c) => c.category !== 'starting_capital').sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  const maxAbs = Math.max(1, ...sorted.map((c) => Math.abs(c.total)));

  const visitPending = await tutorialPending(db, user.id, 'finances');
  return (
    <div className="space-y-6">
      <TutorialVisit step="finances" pending={visitPending} />
      <PageHeader title="Финанси" subtitle="Счетоводна книга: всяко движение на пари е запис с баланс след него. Всички суми се изчисляват от сървъра." />
      <div className="grid gap-3 sm:grid-cols-3">
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
      <Card title="Счетоводна книга">
        <Table head={['Дата', 'Категория', 'Описание', 'Сума', 'Баланс']}>
          {entries.map((e) => (
            <tr key={e.id}>
              <td className="whitespace-nowrap px-3 py-2 text-mist-400">{dateTime(e.createdAt)}</td>
              <td className="px-3 py-2">{LEDGER_LABELS[e.category as LedgerCategory] ?? e.category}</td>
              <td className="px-3 py-2 text-mist-300">{e.description}</td>
              <td className={`num whitespace-nowrap px-3 py-2 text-right ${e.amountCents >= 0 ? 'text-profit' : 'text-loss'}`}>{moneyPrecise(e.amountCents)}</td>
              <td className="num whitespace-nowrap px-3 py-2 text-right">{moneyPrecise(e.balanceAfterCents)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
