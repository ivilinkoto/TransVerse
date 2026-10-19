import { AlertTriangle, CheckCircle2, Undo2 } from 'lucide-react';
import { ActionButton } from '@/components/ui/ActionButton';
import { PaypalCheck } from '@/components/admin/PaypalCheck';
import Link from 'next/link';
import { Badge, Card, PageHeader, Stat, Table } from '@/components/ui';
import { dateTime, int, money } from '@/lib/format';
import { recentTransfers } from '@/server/game/transfers';
import { euro, paidProduct, PAYMENT_STATUS_LABELS } from '@/lib/game/payments';
import { adminContext } from '@/server/admin-context';
import { isAdmin } from '@/server/auth/roles';
import { adminPayments, paymentConfig } from '@/server/payments';

export const metadata = { title: 'Плащания' };

const PROVIDER_LABELS: Record<string, string> = { paypal: 'PayPal', stripe: 'Stripe', google_play: 'Google Play' };
const TONE: Record<string, 'green' | 'gold' | 'red' | 'neutral'> = { paid: 'green', pending: 'gold', failed: 'red', expired: 'neutral', refunded: 'red' };

export default async function AdminPaymentsPage() {
  const { db, user } = await adminContext();
  const config = paymentConfig();
  const { rows, totals } = await adminPayments(db);
  const transfers = await recentTransfers(db, 100);
  return (
    <div className="space-y-6">
      <PageHeader title="Плащания" subtitle="Покупки на ТрансКоин и VIP с реални пари (PayPal на сайта, Google Play в Android приложението; Stripe — по-късно). Доставката е автоматична. Плащане с PayPal може да се върне оттук; ТрансКоин и VIP дните от покупката се премахват автоматично." />
      <Card title="Настройка">
        <ul className="space-y-2 text-sm">
          <li className="flex flex-wrap items-center gap-2">
            <span className="w-20 font-semibold">PayPal</span>
            {config.paypal.enabled ? (
              <span className="flex items-center gap-1.5 text-profit"><CheckCircle2 className="h-4 w-4" />включен · {config.paypal.sandbox ? 'ТЕСТОВ режим (sandbox)' : 'реален режим (live)'}{config.paypal.webhook ? ' · webhook' : ' · без webhook (сверката е от фоновия процес)'}</span>
            ) : (
              <span className="flex items-center gap-1.5 text-amber-sig"><AlertTriangle className="h-4 w-4" />изключен — липсват: <span className="num text-mist-300">{config.paypal.missing.join(', ')}</span></span>
            )}
          </li>
          <li className="flex flex-wrap items-center gap-2">
            <span className="w-20 font-semibold">Google Play</span>
            {config.googlePlay.enabled ? (
              <span className="flex items-center gap-1.5 text-profit"><CheckCircle2 className="h-4 w-4" />включен · {config.googlePlay.packageName} · само в Android приложението</span>
            ) : (
              <span className="text-mist-400">изключен — липсват: <span className="num">{config.googlePlay.missing.join(', ')}</span></span>
            )}
          </li>
          <li className="flex flex-wrap items-center gap-2">
            <span className="w-20 font-semibold">Stripe</span>
            {config.stripe.enabled ? (
              <span className="flex items-center gap-1.5 text-profit"><CheckCircle2 className="h-4 w-4" />включен · {config.stripe.testMode ? 'ТЕСТОВ режим' : 'реален режим'}</span>
            ) : (
              <span className="text-mist-400">изключен (за след домейна) — липсват: <span className="num">{config.stripe.missing.join(', ')}</span></span>
            )}
          </li>
        </ul>
        {config.appUrlInvalid && <p className="mt-2 text-sm text-amber-sig">APP_URL не е пълен адрес (трябва да започва с https://) — пренебрегва се и се ползва адресът, от който играчът отваря сайта.</p>}
        {isAdmin(user.role) && config.paypal.enabled && <PaypalCheck />}
        {isAdmin(user.role) && config.googlePlay.enabled && <PaypalCheck type="checkGooglePlay" label="Google Play" />}
        {isAdmin(user.role) && <p className="mt-3 text-xs text-mist-400">Ключовете се добавят в GitHub → Settings → Secrets and variables → Actions и се записват на сървъра при следващия Deploy (виж docs/DEPLOYMENT.md, „Плащания“). Никога в кода или в чат.</p>}
        <p className="mt-1 text-xs text-mist-400">Webhook адреси (по избор, изискват HTTPS): <code>/api/payments/paypal</code>, <code>/api/payments/stripe</code> · Публични страници: <Link className="underline" href="/terms">/terms</Link>, <Link className="underline" href="/privacy">/privacy</Link></p>
      </Card>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Платени общо" value={euro(totals.paid)} hint={`${int(totals.paidCount)} покупки`} tone="profit" />
        <Stat label="Последните 30 дни" value={euro(totals.last30)} tone="gold" />
        <Stat label="Възстановени" value={euro(totals.refunded)} tone="loss" />
      </div>
      <Card title="Последни плащания">
        <Table head={['Дата', 'Играч', 'Продукт', 'Сума', 'Статус', 'Доставчик', '']}>
          {rows.map(({ payment: p, username }) => (
            <tr key={p.id}>
              <td className="px-3 py-2 text-mist-400">{dateTime(p.createdAt)}</td>
              <td className="px-3 py-2"><Link href={`/admin/users/${p.userId}`} className="hover:underline">{username}</Link></td>
              <td className="px-3 py-2">{paidProduct(p.productId)?.label ?? p.productId}</td>
              <td className="num px-3 py-2">{euro(p.amountCents)}</td>
              <td className="px-3 py-2">
                <Badge tone={TONE[p.status] ?? 'neutral'}>{PAYMENT_STATUS_LABELS[p.status] ?? p.status}</Badge>
                {p.failureReason && <div className="mt-1 max-w-xs font-mono text-[11px] text-loss" title="Отговор от платежния доставчик">{p.failureReason}</div>}
              </td>
              <td className="px-3 py-2 text-xs text-mist-400">{PROVIDER_LABELS[p.provider] ?? p.provider} <span className="font-mono">{p.captureId ?? p.orderId ?? p.paymentIntentId ?? p.checkoutSessionId?.slice(0, 18) ?? ''}</span></td>
              <td className="px-3 py-2">
                {isAdmin(user.role) && p.provider === 'paypal' && p.status === 'paid' && (
                  <ActionButton endpoint="/api/admin/action" action={{ type: 'refundPayment', paymentId: p.id }} className="btn-ghost px-3 py-1.5 text-xs" confirm={`Да върнем ли ${euro(p.amountCents)} на ${username}? ТрансКоин / VIP дните от покупката ще бъдат премахнати.`}>
                    <Undo2 className="h-3.5 w-3.5" />Върни сумата
                  </ActionButton>
                )}
              </td>
            </tr>
          ))}
        </Table>
        {rows.length === 0 && <p className="mt-3 text-sm text-mist-400">Все още няма плащания.</p>}
      </Card>
      <Card title="Преводи между играчи (игрови пари)" className="p-2 sm:p-3">
        {transfers.length === 0 ? <p className="p-3 text-sm text-mist-400">Още няма преводи.</p> : (
          <Table head={['Кога', 'От', 'До', 'Сума', 'Такса', 'Бележка']}>
            {transfers.map((t) => (
              <tr key={t.id}>
                <td className="px-3 py-2 text-mist-400">{dateTime(t.createdAt)}</td>
                <td className="px-3 py-2"><Link href={`/admin/users/${t.fromId}`} className="hover:underline">{t.from}</Link></td>
                <td className="px-3 py-2"><Link href={`/admin/users/${t.toId}`} className="hover:underline">{t.to}</Link></td>
                <td className="num px-3 py-2">{money(t.amountCents)}</td>
                <td className="num px-3 py-2 text-mist-400">{money(t.feeCents)}</td>
                <td className="max-w-xs truncate px-3 py-2 text-mist-300">{t.note}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
