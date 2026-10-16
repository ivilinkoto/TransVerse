import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { Badge, Card, PageHeader, Stat, Table } from '@/components/ui';
import { dateTime, int } from '@/lib/format';
import { euro, paidProduct, PAYMENT_STATUS_LABELS } from '@/lib/game/payments';
import { adminContext } from '@/server/admin-context';
import { isAdmin } from '@/server/auth/roles';
import { adminPayments, paymentConfig } from '@/server/payments';

export const metadata = { title: 'Плащания' };

const TONE: Record<string, 'green' | 'gold' | 'red' | 'neutral'> = { paid: 'green', pending: 'gold', failed: 'red', expired: 'neutral', refunded: 'red' };

export default async function AdminPaymentsPage() {
  const { db, user } = await adminContext();
  const config = paymentConfig();
  const { rows, totals } = await adminPayments(db);
  return (
    <div className="space-y-6">
      <PageHeader title="Плащания" subtitle="Покупки на ТрансКоин и VIP с реални пари през Stripe. Доставката е автоматична; възстановяванията се правят от таблото на Stripe и се отразяват тук сами." />
      <Card title="Настройка">
        {config.enabled ? (
          <p className="flex items-center gap-2 text-sm text-profit"><CheckCircle2 className="h-4 w-4" />Плащанията са включени{config.testMode ? ' — ТЕСТОВ режим (sk_test), не се теглят истински пари' : ' — реален режим'}.</p>
        ) : (
          <div className="text-sm">
            <p className="flex items-center gap-2 text-amber-sig"><AlertTriangle className="h-4 w-4" />Плащанията са изключени. Липсват настройки на сървъра:</p>
            <p className="num mt-2 text-mist-300">{config.missing.join(', ')}</p>
            {isAdmin(user.role) && <p className="mt-2 text-mist-400">Добавят се във файла <code>/etc/transverse/transverse.env</code> на сървъра (виж docs/DEPLOYMENT.md, раздел „Плащания“). Ключовете никога не се пишат в кода или в чат.</p>}
          </div>
        )}
        <p className="mt-2 text-xs text-mist-400">Webhook адрес за Stripe: <code>{(process.env.APP_URL ?? 'https://ДОМЕЙН').replace(/\/$/, '')}/api/payments/stripe</code> · Публични страници: <Link className="underline" href="/terms">/terms</Link>, <Link className="underline" href="/privacy">/privacy</Link></p>
      </Card>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Платени общо" value={euro(totals.paid)} hint={`${int(totals.paidCount)} покупки`} tone="profit" />
        <Stat label="Последните 30 дни" value={euro(totals.last30)} tone="gold" />
        <Stat label="Възстановени" value={euro(totals.refunded)} tone="loss" />
      </div>
      <Card title="Последни плащания">
        <Table head={['Дата', 'Играч', 'Продукт', 'Сума', 'Статус', 'Stripe']}>
          {rows.map(({ payment: p, username }) => (
            <tr key={p.id}>
              <td className="px-3 py-2 text-mist-400">{dateTime(p.createdAt)}</td>
              <td className="px-3 py-2"><Link href={`/admin/users/${p.userId}`} className="hover:underline">{username}</Link></td>
              <td className="px-3 py-2">{paidProduct(p.productId)?.label ?? p.productId}</td>
              <td className="num px-3 py-2">{euro(p.amountCents)}</td>
              <td className="px-3 py-2"><Badge tone={TONE[p.status] ?? 'neutral'}>{PAYMENT_STATUS_LABELS[p.status] ?? p.status}</Badge></td>
              <td className="px-3 py-2 font-mono text-xs text-mist-400">{p.paymentIntentId ?? p.checkoutSessionId?.slice(0, 18) ?? '—'}</td>
            </tr>
          ))}
        </Table>
        {rows.length === 0 && <p className="mt-3 text-sm text-mist-400">Все още няма плащания.</p>}
      </Card>
    </div>
  );
}
