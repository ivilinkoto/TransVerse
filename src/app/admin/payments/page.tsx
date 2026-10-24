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
import { t as tr, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: tr('Плащания') };
}

const TONE: Record<string, 'green' | 'gold' | 'red' | 'neutral'> = { paid: 'green', pending: 'gold', failed: 'red', expired: 'neutral', refunded: 'red' };

export default async function AdminPaymentsPage() {
  await initLocale();
  const { db, user } = await adminContext();
  const config = paymentConfig();
  const { rows, totals } = await adminPayments(db);
  const transfers = await recentTransfers(db, 100);
  return (
    <div className="space-y-6">
      <PageHeader title={tr('Плащания')} subtitle={tr('Покупки на ТрансКоин и VIP с реални пари (PayPal и карта през Stripe). Доставката е автоматична. Плащане с PayPal се връща оттук, а със Stripe — от таблото на Stripe (Payments → Refund); и в двата случая ТрансКоин и VIP дните от покупката се премахват автоматично.')} />
      <Card title={tr('Настройка')}>
        <ul className="space-y-2 text-sm">
          <li className="flex flex-wrap items-center gap-2">
            <span className="w-20 font-semibold">PayPal</span>
            {config.paypal.enabled ? (
              <span className="flex items-center gap-1.5 text-profit"><CheckCircle2 className="h-4 w-4" />{tr('включен · {0}{1}', config.paypal.sandbox ? tr('ТЕСТОВ режим (sandbox)') : tr('реален режим (live)'), config.paypal.webhook ? ' · webhook' : tr(' · без webhook (сверката е от фоновия процес)'))}</span>
            ) : (
              <span className="flex items-center gap-1.5 text-amber-sig"><AlertTriangle className="h-4 w-4" />{tr('изключен — липсват:')}{' '}<span className="num text-mist-300">{config.paypal.missing.join(', ')}</span></span>
            )}
          </li>
          <li className="flex flex-wrap items-center gap-2">
            <span className="w-20 font-semibold">Stripe</span>
            {config.stripe.enabled ? (
              <span className="flex items-center gap-1.5 text-profit"><CheckCircle2 className="h-4 w-4" />{tr('включен · {0}', config.stripe.testMode ? tr('ТЕСТОВ режим') : tr('реален режим'))}</span>
            ) : (
              <span className="text-mist-400">{tr('изключен — липсват:')}{' '}<span className="num">{config.stripe.missing.join(', ')}</span></span>
            )}
          </li>
        </ul>
        {config.appUrlInvalid && <p className="mt-2 text-sm text-amber-sig">{tr('APP_URL не е пълен адрес (трябва да започва с https://) — пренебрегва се и се ползва адресът, от който играчът отваря сайта.')}</p>}
        {isAdmin(user.role) && config.paypal.enabled && <PaypalCheck />}
        {isAdmin(user.role) && <p className="mt-3 text-xs text-mist-400">{tr('Ключовете се добавят в GitHub → Settings → Secrets and variables → Actions и се записват на сървъра при следващия Deploy (виж docs/DEPLOYMENT.md, „Плащания“). Никога в кода или в чат.')}</p>}
        <p className="mt-1 text-xs text-mist-400">{tr('Webhook адреси (по избор, изискват HTTPS):')}{' '}<code>/api/payments/paypal</code>, <code>/api/payments/stripe</code>{' '}{tr('· Публични страници:')}{' '}<Link className="underline" href="/terms">/terms</Link>, <Link className="underline" href="/privacy">/privacy</Link></p>
      </Card>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={tr('Платени общо')} value={euro(totals.paid)} hint={tr('{0} покупки', int(totals.paidCount))} tone="profit" />
        <Stat label={tr('Последните 30 дни')} value={euro(totals.last30)} tone="gold" />
        <Stat label={tr('Възстановени')} value={euro(totals.refunded)} tone="loss" />
      </div>
      <Card title={tr('Последни плащания')}>
        <Table head={[tr('Дата'), tr('Играч'), tr('Продукт'), tr('Сума'), tr('Статус'), tr('Доставчик'), '']}>
          {rows.map(({ payment: p, username }) => (
            <tr key={p.id}>
              <td className="px-3 py-2 text-mist-400">{dateTime(p.createdAt)}</td>
              <td className="px-3 py-2"><Link href={`/admin/users/${p.userId}`} className="hover:underline">{username}</Link></td>
              <td className="px-3 py-2">{paidProduct(p.productId)?.label ?? p.productId}</td>
              <td className="num px-3 py-2">{euro(p.amountCents)}</td>
              <td className="px-3 py-2">
                <Badge tone={TONE[p.status] ?? 'neutral'}>{PAYMENT_STATUS_LABELS[p.status] ?? p.status}</Badge>
                {p.failureReason && <div className="mt-1 max-w-xs font-mono text-[11px] text-loss" title={tr('Отговор от платежния доставчик')}>{tx(p.failureReason)}</div>}
              </td>
              <td className="px-3 py-2 text-xs text-mist-400">{p.provider === 'paypal' ? 'PayPal' : 'Stripe'} <span className="font-mono">{p.captureId ?? p.orderId ?? p.paymentIntentId ?? p.checkoutSessionId?.slice(0, 18) ?? ''}</span></td>
              <td className="px-3 py-2">
                {isAdmin(user.role) && p.provider === 'paypal' && p.status === 'paid' && (
                  <ActionButton endpoint="/api/admin/action" action={{ type: 'refundPayment', paymentId: p.id }} className="btn-ghost px-3 py-1.5 text-xs" confirm={tr('Да върнем ли {0} на {1}? ТрансКоин / VIP дните от покупката ще бъдат премахнати.', euro(p.amountCents), username)}>
                    <Undo2 className="h-3.5 w-3.5" />{tr('Върни сумата')}
                  </ActionButton>
                )}
              </td>
            </tr>
          ))}
        </Table>
        {rows.length === 0 && <p className="mt-3 text-sm text-mist-400">{tr('Все още няма плащания.')}</p>}
      </Card>
      <Card title={tr('Преводи между играчи (игрови пари)')} className="p-2 sm:p-3">
        {transfers.length === 0 ? <p className="p-3 text-sm text-mist-400">{tr('Още няма преводи.')}</p> : (
          <Table head={[tr('Кога'), tr('От'), tr('До'), tr('Сума'), tr('Такса'), tr('Бележка')]}>
            {transfers.map((t) => (
              <tr key={t.id}>
                <td className="px-3 py-2 text-mist-400">{dateTime(t.createdAt)}</td>
                <td className="px-3 py-2"><Link href={`/admin/users/${t.fromId}`} className="hover:underline">{tx(t.from)}</Link></td>
                <td className="px-3 py-2"><Link href={`/admin/users/${t.toId}`} className="hover:underline">{tx(t.to)}</Link></td>
                <td className="num px-3 py-2">{money(t.amountCents)}</td>
                <td className="num px-3 py-2 text-mist-400">{money(t.feeCents)}</td>
                <td className="max-w-xs truncate px-3 py-2 text-mist-300">{tx(t.note)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
