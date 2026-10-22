import { Badge, Card, PageHeader, Stat } from '@/components/ui';
import { int, money } from '@/lib/format';
import { adminContext } from '@/server/admin-context';
import { balanceSuggestion, economyOverview, FRAUD, fraudSignals, payFactor } from '@/server/admin-economy';
import { ActionButton } from '@/components/ui/ActionButton';
import { CompensationForm } from '@/components/admin/CompensationForm';
import { featureLive } from '@/lib/game/features';
import { COMPENSATION } from '@/server/admin';
import { isAdmin } from '@/server/auth/roles';
import { LEDGER_LABELS, type LedgerCategory } from '@/server/game/finance';

export const metadata = { title: 'Икономика' };
export const dynamic = 'force-dynamic';

const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1).replace('.', ',')} %`;

/** The game economy and the anti-fraud signals (v1.4). Signals only — the staff decide. */
export default async function AdminEconomy() {
  const { db, now, user } = await adminContext();
  const [eco, fraud, factor] = await Promise.all([economyOverview(db, now), fraudSignals(db, now), payFactor(db)]);
  const suggestion = balanceSuggestion(eco.inflation, factor);
  const payChange = eco.avgPay != null && eco.avgPayLastWeek ? eco.avgPay / eco.avgPayLastWeek - 1 : null;
  return (
    <div className="space-y-6">
      <PageHeader title="Икономика" subtitle="Парите в играта, потоците за седмицата и сигнали за измами (игрови данни)." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Пари в играта" value={money(eco.total)} hint={`играчи ${money(eco.players)} · каси ${money(eco.treasuries)}`} />
        <Stat label="Нетно за 7 дни" value={money(eco.netWeek)} hint={`предходните 7: ${money(eco.netLastWeek)}`} />
        <Stat label="Инфлация (7 дни)" value={pct(eco.inflation)} hint="ръст на парите на играчите за седмицата" />
        <Stat label="Средно на курс" value={eco.avgPay == null ? '—' : money(eco.avgPay)} hint={`${int(eco.trips)} курса · ${payChange == null ? 'няма сравнение' : `${pct(payChange)} спрямо миналата седмица`}`} />
      </div>
      <Card title="Баланс на заплащането">
        <p className="text-sm text-mist-300">Множител на заплащането на новите товари: <b className="num">×{factor.toFixed(2)}</b> (1,00 = без промяна). Променя се само когато администратор го приложи; вече поетите товари не се засягат.</p>
        {suggestion ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-sig/40 bg-amber-sig/10 p-3 text-sm">
            <span>{suggestion.reason} Нов множител: <b className="num">×{suggestion.factor.toFixed(2)}</b>.</span>
            <ActionButton action={{ type: 'applyPayFactor', factor: suggestion.factor }} endpoint="/api/admin/action" className="btn-primary" confirm={`Да приложим ли ×${suggestion.factor.toFixed(2)} за новите товари?`}>Приложи</ActionButton>
          </div>
        ) : <p className="mt-2 text-sm text-profit">Икономиката е в норма — няма предложение.</p>}
        {factor !== 1 && <div className="mt-2"><ActionButton action={{ type: 'applyPayFactor', factor: 1 }} endpoint="/api/admin/action" className="btn-ghost" confirm="Да върнем ли множителя на ×1,00?">Върни на ×1,00</ActionButton></div>}
      </Card>
      {isAdmin(user.role) && featureLive('compensation', now, true) && (
        <Card title="Компенсация за всички">
          <p className="mb-3 text-sm text-mist-300">Еднаква сума или ТрансКоин за всеки активен (неблокиран) играч — напр. след прекъсване. До {COMPENSATION.maxCents / 100} лв. или {COMPENSATION.maxCoins} TC. Записва се в одита; всеки играч получава известие с причината.</p>
          <CompensationForm />
        </Card>
      )}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Потоци за 7 дни (по категории)">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-mist-400"><th className="py-1">Категория</th><th className="text-right">Влезли</th><th className="text-right">Излезли</th></tr></thead>
            <tbody>
              {eco.flows.map((f) => (
                <tr key={f.category} className="border-t border-asphalt-800">
                  <td className="py-1.5">{LEDGER_LABELS[f.category as LedgerCategory] ?? f.category}</td>
                  <td className="num text-right text-profit">{f.income ? money(f.income) : '—'}</td>
                  <td className="num text-right text-loss">{f.spent ? money(f.spent) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Най-богатите">
          <ol className="space-y-1.5 text-sm">
            {eco.richest.map((r, i) => (
              <li key={r.username} className="flex justify-between gap-2"><span>{i + 1}. {r.username} <span className="text-xs text-mist-400">· {int(r.deliveries)} курса</span></span><span className="num">{money(r.balance)}</span></li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-mist-400">ТрансКоин в обращение: <span className="num">{int(eco.coins)}</span> · игрови сметки: {int(eco.accounts)}</p>
        </Card>
      </div>

      <h2 className="font-display text-xl font-bold">Сигнали за измами</h2>
      <p className="-mt-4 text-sm text-mist-400">Само сигнали — никой не се наказва автоматично. Проверете в „Потребители“ преди действие.</p>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Една и съща мрежа при регистрация">
          {fraud.networks.length === 0 ? <p className="text-sm text-mist-400">Няма.</p> : (
            <ul className="space-y-1.5 text-sm">
              {fraud.networks.map((n) => <li key={n.hash}><Badge tone="orange">{n.n} акаунта</Badge> <span className="font-mono text-xs text-mist-400">{n.hash}</span> {n.users.join(', ')}</li>)}
            </ul>
          )}
        </Card>
        <Card title="Преводи между акаунти от една мрежа (7 дни)">
          {fraud.sameNetwork.length === 0 ? <p className="text-sm text-mist-400">Няма.</p> : (
            <ul className="space-y-1.5 text-sm">
              {fraud.sameNetwork.map((t) => <li key={`${t.from}-${t.to}`} className="flex justify-between gap-2"><span>{t.from} → {t.to} <span className="text-xs text-mist-400">· {t.n} пъти</span></span><span className="num text-loss">{money(t.amount)}</span></li>)}
            </ul>
          )}
        </Card>
        <Card title={`Големи или чести преводи (от ${money(FRAUD.bigTransferCents)} или ${FRAUD.manyTransfers}+ пъти за 7 дни)`}>
          {fraud.transfers.length === 0 ? <p className="text-sm text-mist-400">Няма.</p> : (
            <ul className="space-y-1.5 text-sm">
              {fraud.transfers.map((t) => <li key={`${t.from}-${t.to}`} className="flex justify-between gap-2"><span>{t.from} → {t.to} <span className="text-xs text-mist-400">· {t.n} пъти</span></span><span className="num">{money(t.amount)}</span></li>)}
            </ul>
          )}
        </Card>
        <Card title={`Бързи пари (нетно над ${money(FRAUD.fastMoneyCents)} за 24 ч)`}>
          {fraud.fast.length === 0 ? <p className="text-sm text-mist-400">Няма.</p> : (
            <ul className="space-y-1.5 text-sm">
              {fraud.fast.map((f) => (
                <li key={f.username} className="flex justify-between gap-2">
                  <span>{f.username} {f.other > f.freight && <Badge tone="red">не от превози</Badge>}</span>
                  <span className="num">{money(f.net)} <span className="text-xs text-mist-400">(превози {money(f.freight)} · други {money(f.other)})</span></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
