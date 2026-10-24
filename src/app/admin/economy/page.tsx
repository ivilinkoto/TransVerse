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
import { t as tr, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: tr('Икономика') };
}
export const dynamic = 'force-dynamic';

const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1).replace('.', ',')} %`;

/** The game economy and the anti-fraud signals (v1.4). Signals only — the staff decide. */
export default async function AdminEconomy() {
  await initLocale();
  const { db, now, user } = await adminContext();
  const [eco, fraud, factor] = await Promise.all([economyOverview(db, now), fraudSignals(db, now), payFactor(db)]);
  const suggestion = balanceSuggestion(eco.inflation, factor);
  const payChange = eco.avgPay != null && eco.avgPayLastWeek ? eco.avgPay / eco.avgPayLastWeek - 1 : null;
  return (
    <div className="space-y-6">
      <PageHeader title={tr('Икономика')} subtitle={tr('Парите в играта, потоците за седмицата и сигнали за измами (игрови данни).')} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={tr('Пари в играта')} value={money(eco.total)} hint={tr('играчи {0} · каси {1}', money(eco.players), money(eco.treasuries))} />
        <Stat label={tr('Нетно за 7 дни')} value={money(eco.netWeek)} hint={tr('предходните 7: {0}', money(eco.netLastWeek))} />
        <Stat label={tr('Инфлация (7 дни)')} value={pct(eco.inflation)} hint={tr('ръст на парите на играчите за седмицата')} />
        <Stat label={tr('Средно на курс')} value={eco.avgPay == null ? '—' : money(eco.avgPay)} hint={tr('{0} курса · {1}', int(eco.trips), payChange == null ? tr('няма сравнение') : tr('{0} спрямо миналата седмица', pct(payChange)))} />
      </div>
      <Card title={tr('Баланс на заплащането')}>
        <p className="text-sm text-mist-300">{tr('Множител на заплащането на новите товари:')}{' '}<b className="num">×{factor.toFixed(2)}</b>{' '}{tr('(1,00 = без промяна). Променя се само когато администратор го приложи; вече поетите товари не се засягат.')}</p>
        {suggestion ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-sig/40 bg-amber-sig/10 p-3 text-sm">
            <span>{tr('{0} Нов множител:', suggestion.reason)}{' '}<b className="num">×{suggestion.factor.toFixed(2)}</b>.</span>
            <ActionButton action={{ type: 'applyPayFactor', factor: suggestion.factor }} endpoint="/api/admin/action" className="btn-primary" confirm={tr('Да приложим ли ×{0} за новите товари?', suggestion.factor.toFixed(2))}>{tr('Приложи')}</ActionButton>
          </div>
        ) : <p className="mt-2 text-sm text-profit">{tr('Икономиката е в норма — няма предложение.')}</p>}
        {factor !== 1 && <div className="mt-2"><ActionButton action={{ type: 'applyPayFactor', factor: 1 }} endpoint="/api/admin/action" className="btn-ghost" confirm={tr('Да върнем ли множителя на ×1,00?')}>{tr('Върни на ×1,00')}</ActionButton></div>}
      </Card>
      {isAdmin(user.role) && featureLive('compensation', now, true) && (
        <Card title={tr('Компенсация за всички')}>
          <p className="mb-3 text-sm text-mist-300">{tr('Еднаква сума или ТрансКоин за всеки активен (неблокиран) играч — напр. след прекъсване. До {0} лв. или {1} TC. Записва се в одита; всеки играч получава известие с причината.', COMPENSATION.maxCents / 100, COMPENSATION.maxCoins)}</p>
          <CompensationForm />
        </Card>
      )}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title={tr('Потоци за 7 дни (по категории)')}>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-mist-400"><th className="py-1">{tr('Категория')}</th><th className="text-right">{tr('Влезли')}</th><th className="text-right">{tr('Излезли')}</th></tr></thead>
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
        <Card title={tr('Най-богатите')}>
          <ol className="space-y-1.5 text-sm">
            {eco.richest.map((r, i) => (
              <li key={r.username} className="flex justify-between gap-2"><span>{i + 1}. {tx(r.username)} <span className="text-xs text-mist-400">{tr('· {0} курса', int(r.deliveries))}</span></span><span className="num">{money(r.balance)}</span></li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-mist-400">{tr('ТрансКоин в обращение:')}{' '}<span className="num">{int(eco.coins)}</span>{' '}{tr('· игрови сметки: {0}', int(eco.accounts))}</p>
        </Card>
      </div>

      <h2 className="font-display text-xl font-bold">{tr('Сигнали за измами')}</h2>
      <p className="-mt-4 text-sm text-mist-400">{tr('Само сигнали — никой не се наказва автоматично. Проверете в „Потребители“ преди действие.')}</p>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title={tr('Една и съща мрежа при регистрация')}>
          {fraud.networks.length === 0 ? <p className="text-sm text-mist-400">{tr('Няма.')}</p> : (
            <ul className="space-y-1.5 text-sm">
              {fraud.networks.map((n) => <li key={n.hash}><Badge tone="orange">{tr('{0} акаунта', n.n)}</Badge> <span className="font-mono text-xs text-mist-400">{tx(n.hash)}</span> {n.users.join(', ')}</li>)}
            </ul>
          )}
        </Card>
        <Card title={tr('Преводи между акаунти от една мрежа (7 дни)')}>
          {fraud.sameNetwork.length === 0 ? <p className="text-sm text-mist-400">{tr('Няма.')}</p> : (
            <ul className="space-y-1.5 text-sm">
              {fraud.sameNetwork.map((t) => <li key={`${t.from}-${t.to}`} className="flex justify-between gap-2"><span>{tx(t.from)} → {tx(t.to)} <span className="text-xs text-mist-400">{tr('· {0} пъти', t.n)}</span></span><span className="num text-loss">{money(t.amount)}</span></li>)}
            </ul>
          )}
        </Card>
        <Card title={tr('Големи или чести преводи (от {0} или {1}+ пъти за 7 дни)', money(FRAUD.bigTransferCents), FRAUD.manyTransfers)}>
          {fraud.transfers.length === 0 ? <p className="text-sm text-mist-400">{tr('Няма.')}</p> : (
            <ul className="space-y-1.5 text-sm">
              {fraud.transfers.map((t) => <li key={`${t.from}-${t.to}`} className="flex justify-between gap-2"><span>{tx(t.from)} → {tx(t.to)} <span className="text-xs text-mist-400">{tr('· {0} пъти', t.n)}</span></span><span className="num">{money(t.amount)}</span></li>)}
            </ul>
          )}
        </Card>
        <Card title={tr('Бързи пари (нетно над {0} за 24 ч)', money(FRAUD.fastMoneyCents))}>
          {fraud.fast.length === 0 ? <p className="text-sm text-mist-400">{tr('Няма.')}</p> : (
            <ul className="space-y-1.5 text-sm">
              {fraud.fast.map((f) => (
                <li key={f.username} className="flex justify-between gap-2">
                  <span>{tx(f.username)} {f.other > f.freight && <Badge tone="red">{tr('не от превози')}</Badge>}</span>
                  <span className="num">{money(f.net)} <span className="text-xs text-mist-400">{tr('(превози {0} · други {1})', money(f.freight), money(f.other))}</span></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
